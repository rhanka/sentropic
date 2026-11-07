import { createHash } from 'node:crypto';
import type { LiveKey, LiveRuntime } from './records';
import { conflict, LiveError } from './records';
import { BUILDER_IMAGE, artifactEnvironment } from './recipes';

import type { BuilderPlacement } from './placement';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40);
export const bindingLabel = (key: LiveKey) => digest([key.storageScopeId, key.artifactId]);
export const podName = (key: LiveKey) => `artifact-${bindingLabel(key)}`;
const labels = (key: LiveKey, runtime: LiveRuntime) => ({
  'sentropic.dev/artifact-binding': bindingLabel(key),
  'sentropic.dev/artifact-session': digest(runtime.sessionId),
  'sentropic.dev/artifact-generation': String(runtime.generation),
  'sentropic.dev/artifact-lease': String(runtime.leaseEpoch),
});
/** emptyDir sizes (s-archi 2026-11-07 (a)): source, scratch /tmp (npm cache, Vite cache, build output), installed tree. */
export const VOLUME_LIMITS = Object.freeze({ source: '512Mi', scratch: '2Gi', dependencies: '1536Mi' });
/** Bootstrap is trusted host code, not repository content or a caller-supplied command. */
export function builderPod(key: LiveKey, runtime: LiveRuntime, bootstrap: string, placement: BuilderPlacement) {
  if (!bootstrap || runtime.podName !== podName(key)) throw new LiveError('builder_unavailable');
  return { apiVersion: 'v1', kind: 'Pod', metadata: {
    name: runtime.podName, namespace: placement.namespace, labels: labels(key, runtime),
  }, spec: {
    serviceAccountName: 'artifact-builder', automountServiceAccountToken: false, enableServiceLinks: false,
    nodeSelector: { nodepool: 'artifact-builders' },
    tolerations: [{ key: 'sentropic.dev/pool', operator: 'Equal', value: 'artifact-builders', effect: 'NoExecute' }],
    // A-LIVE Amendment 1: no activeDeadlineSeconds; the bootstrap liveness lease bounds an unattended pod.
    restartPolicy: 'Never', terminationGracePeriodSeconds: 10,
    securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000,
      seccompProfile: { type: 'RuntimeDefault' } },
    containers: [{ name: 'builder', image: BUILDER_IMAGE, imagePullPolicy: 'IfNotPresent',
      workingDir: '/workspace', command: ['node', '--input-type=module', '-e', bootstrap],
      env: [...Object.entries(artifactEnvironment()).map(([name, value]) => ({ name, value })),
        { name: 'ARTIFACT_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } }],
      securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true,
        capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } },
      // L0 measured cap adjustment (A-LIVE §12): 4 live pods per d2-4 node; only the limits overcommit.
      // The memory limit holds the in-pod clean build (heap 1024); the ephemeral limit is the emptyDir sum.
      resources: { requests: { cpu: '350m', memory: '450Mi', 'ephemeral-storage': '0' },
        limits: { cpu: '2', memory: '1536Mi', 'ephemeral-storage': '4Gi' } },
      ports: [{ name: 'live', containerPort: 5173, protocol: 'TCP' }],
      volumeMounts: [{ name: 'source', mountPath: '/workspace' }, { name: 'scratch', mountPath: '/tmp' },
        { name: 'dependencies', mountPath: '/dependencies' }],
    }],
    volumes: Object.entries(VOLUME_LIMITS).map(([name, sizeLimit]) => ({ name, emptyDir: { sizeLimit } })),
  } };
}
interface Pod {
  metadata: { uid: string; labels: Record<string, string>; deletionTimestamp?: string };
  status?: { phase?: string };
}
export interface KubernetesCore {
  get<T>(resource: 'pods' | 'services', name: string): Promise<T | undefined>;
  create<T>(resource: 'pods' | 'services', value: unknown): Promise<T>;
  delete(resource: 'pods' | 'services', name: string, uid?: string): Promise<void>;
  /** Must confirm 404, not merely accept a DELETE request or a terminating phase. */
  waitDeleted(resource: 'pods' | 'services', name: string, uid?: string): Promise<void>;
}
export function createBuilderPods(core: KubernetesCore, bootstrap: string, placement: BuilderPlacement) {
  return {
    async ensure(key: LiveKey, runtime: LiveRuntime) {
      const expected = labels(key, runtime);
      let pod = await core.get<Pod>('pods', runtime.podName);
      if (!pod) {
        if (runtime.podUid !== null) throw new LiveError('builder_unavailable');
        try { pod = await core.create<Pod>('pods', builderPod(key, runtime, bootstrap, placement)); }
        catch (error) {
          // Creation may have committed before a timeout/response loss. Discover before retrying.
          pod = await core.get<Pod>('pods', runtime.podName);
          if (!pod) throw error;
        }
      }
      if (!pod.metadata.uid || Object.entries(expected).some(([k, v]) => pod!.metadata.labels[k] !== v)
        || (runtime.podUid !== null && runtime.podUid !== pod.metadata.uid)) conflict('stale_fence');
      if (pod.metadata.deletionTimestamp || ['Failed', 'Succeeded'].includes(pod.status?.phase ?? '')) {
        throw new LiveError('builder_unavailable');
      }
      const service = { apiVersion: 'v1', kind: 'Service', metadata: {
        name: runtime.podName, namespace: placement.namespace, labels: expected,
      }, spec: { type: 'ClusterIP', selector: expected, ports: [{ name: 'live', port: 5173, targetPort: 5173 }] } };
      const existing = await core.get<{ spec: { selector: Record<string, string> } }>('services', runtime.podName);
      if (existing && Object.entries(expected).some(([k, v]) => existing.spec.selector[k] !== v)) conflict('stale_fence');
      if (!existing) await core.create('services', service);
      return { uid: pod.metadata.uid };
    },
    async remove(key: LiveKey, runtime: LiveRuntime) {
      const pod = await core.get<Pod>('pods', runtime.podName);
      if (pod && (Object.entries(labels(key, runtime)).some(([k, v]) => pod.metadata.labels[k] !== v)
        || (runtime.podUid !== null && runtime.podUid !== pod.metadata.uid))) conflict('stale_fence');
      await core.delete('pods', runtime.podName, pod?.metadata.uid ?? runtime.podUid ?? undefined);
      await core.waitDeleted('pods', runtime.podName, pod?.metadata.uid ?? runtime.podUid ?? undefined);
      // Never remove a replacement service from a stale callback.
      const service = await core.get<{ metadata: Pod['metadata'] }>('services', runtime.podName);
      if (service && Object.entries(labels(key, runtime)).some(([k, v]) => service.metadata.labels[k] !== v)) conflict('stale_fence');
      if (service) {
        await core.delete('services', runtime.podName, service.metadata.uid);
        await core.waitDeleted('services', runtime.podName, service.metadata.uid);
      }
    },
  };
}
