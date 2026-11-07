import { createHash } from 'node:crypto';
import type { LiveKey, LiveRuntime } from './records';
import { conflict, LiveError } from './records';
import { BUILDER_IMAGE, artifactEnvironment } from './recipes';

export const BUILDER_NAMESPACE = 'sentropic-artifact-builders';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40);
export const bindingLabel = (key: LiveKey) => digest([key.storageScopeId, key.artifactId]);
export const podName = (key: LiveKey) => `artifact-${bindingLabel(key)}`;
const labels = (key: LiveKey, runtime: LiveRuntime) => ({
  'sentropic.dev/artifact-binding': bindingLabel(key),
  'sentropic.dev/artifact-session': digest(runtime.sessionId),
  'sentropic.dev/artifact-generation': String(runtime.generation),
  'sentropic.dev/artifact-lease': String(runtime.leaseEpoch),
});
/** Bootstrap is trusted host code, not repository content or a caller-supplied command. */
export function builderPod(key: LiveKey, runtime: LiveRuntime, bootstrap: string) {
  if (!bootstrap || runtime.podName !== podName(key)) throw new LiveError('builder_unavailable');
  return { apiVersion: 'v1', kind: 'Pod', metadata: {
    name: runtime.podName, namespace: BUILDER_NAMESPACE, labels: labels(key, runtime),
  }, spec: {
    serviceAccountName: 'artifact-builder', automountServiceAccountToken: false, enableServiceLinks: false,
    restartPolicy: 'Never', activeDeadlineSeconds: 3600, terminationGracePeriodSeconds: 10,
    securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000,
      seccompProfile: { type: 'RuntimeDefault' } },
    containers: [{ name: 'builder', image: BUILDER_IMAGE, imagePullPolicy: 'IfNotPresent',
      workingDir: '/workspace', command: ['node', '--input-type=module', '-e', bootstrap],
      env: Object.entries(artifactEnvironment()).map(([name, value]) => ({ name, value })),
      securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true,
        capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } },
      resources: { requests: { cpu: '500m', memory: '512Mi', 'ephemeral-storage': '1Gi' },
        limits: { cpu: '1', memory: '1Gi', 'ephemeral-storage': '2Gi' } },
      ports: [{ name: 'live', containerPort: 5173, protocol: 'TCP' }],
      volumeMounts: [{ name: 'source', mountPath: '/workspace' }, { name: 'scratch', mountPath: '/tmp' },
        { name: 'dependencies', mountPath: '/dependencies' }],
    }],
    volumes: ['source', 'scratch', 'dependencies'].map(name => ({ name, emptyDir: { sizeLimit: '512Mi' } })),
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
export function createBuilderPods(core: KubernetesCore, bootstrap: string) {
  return {
    async ensure(key: LiveKey, runtime: LiveRuntime) {
      const expected = labels(key, runtime);
      let pod = await core.get<Pod>('pods', runtime.podName);
      if (!pod) {
        if (runtime.podUid !== null) throw new LiveError('builder_unavailable');
        try { pod = await core.create<Pod>('pods', builderPod(key, runtime, bootstrap)); }
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
        name: runtime.podName, namespace: BUILDER_NAMESPACE, labels: expected,
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
