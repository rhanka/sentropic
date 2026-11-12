import { createHash } from 'node:crypto';
import type { LiveKey, LiveRuntime } from './records';
import { conflict, LiveError } from './records';
import { scrubRecipeOutput, truncateRecipeTail } from './recipe-diagnostics';
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
/** Worker disk sizing in MiB: source (the staged tree), scratch /tmp (npm cache, the install working copy, Vite
 * cache, build output) and dependencies (the materialized sealed tree). Each is a disk role cap (never medium:
 * Memory); their achievable total stays bounded by the container ephemeral limit (WORKER_EPHEMERAL_LIMIT_MIB), which is quota-bound and
 * never raised here. Measured install of a ~1 GiB unpacked tree (preprod 2026-11-09, 745 paths, ~854 MiB unpacked):
 * source ~105, scratch ~1530 peak (tarballs + working copy + npm tmp), dependencies ~854. Defaults hold a ~1 GiB
 * tree with margin within the 3400Mi pod total: dependencies +50%, scratch +9%, source kept at 384 (forge snapshot up to 192 MiB plus build output). */
export interface WorkerSizing { sourceMiB: number; scratchMiB: number; dependenciesMiB: number }
/** Env overrides of the volume caps in MiB; unset or out of range falls back to the safe default (names only).
 * The container limits are quota-bound constants, so no env sizing can break the tenant ResourceQuota fit. */
export const VOLUME_SOURCE_MB_ENV = 'ARTIFACT_VOLUME_SOURCE_MB';
export const VOLUME_SCRATCH_MB_ENV = 'ARTIFACT_VOLUME_SCRATCH_MB';
export const VOLUME_DEPENDENCIES_MB_ENV = 'ARTIFACT_VOLUME_DEPENDENCIES_MB';
export const DEFAULT_WORKER_SIZING = Object.freeze({ sourceMiB: 384, scratchMiB: 1664, dependenciesMiB: 1280 });
/** Container ephemeral limit: the pod is evicted when source+scratch+dependencies (+ logs) pass it, so it bounds the volume
 * total. MAX_BUILDER_PODS x 3400Mi (4 x 3400 = 13600Mi) needs the builder namespace quota limits.ephemeral-storage
 * raised 10Gi to >= 14Gi, so that a ~1 GiB unpacked install (peak ~2.5 GiB on disk, measured 2026-11-09) is not evicted. */
export const WORKER_EPHEMERAL_LIMIT_MIB = 3400;
const volumeMb = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value?.trim());
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
/** Volume total kept under the container ephemeral limit, leaving room for container logs. */
const EPHEMERAL_HEADROOM_MIB = 64;
export function readWorkerSizing(env: Readonly<Record<string, string | undefined>>): WorkerSizing {
  const sizing = {
    sourceMiB: volumeMb(env[VOLUME_SOURCE_MB_ENV], DEFAULT_WORKER_SIZING.sourceMiB, 128, 1024),
    scratchMiB: volumeMb(env[VOLUME_SCRATCH_MB_ENV], DEFAULT_WORKER_SIZING.scratchMiB, 512, 4096),
    dependenciesMiB: volumeMb(env[VOLUME_DEPENDENCIES_MB_ENV], DEFAULT_WORKER_SIZING.dependenciesMiB, 512, 4096),
  };
  // Caps whose total passes the pod ephemeral limit would only move the eviction point: refuse them as a whole.
  const total = sizing.sourceMiB + sizing.scratchMiB + sizing.dependenciesMiB;
  return total <= WORKER_EPHEMERAL_LIMIT_MIB - EPHEMERAL_HEADROOM_MIB ? sizing : defaultWorkerSizing();
}
export const defaultWorkerSizing = (): WorkerSizing => ({ ...DEFAULT_WORKER_SIZING });
/** Bootstrap is trusted host code, not repository content or a caller-supplied command. */
export function builderPod(key: LiveKey, runtime: LiveRuntime, bootstrap: string, placement: BuilderPlacement,
  sizing: WorkerSizing = defaultWorkerSizing()) {
  if (!bootstrap || runtime.podName !== podName(key)) throw new LiveError('builder_unavailable', 'pod_descriptor_invalid');
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
      // Tenant quota fit (owner quota push 2026-11-08, k8s dd7620f; capacity 11/11; memory 11/11):
      // k8s raises LimitRange tenant-defaults cpu max 1 to >= 4 per container (build burst) and the namespace quotas to
      // requests.cpu 1 (4 x 250m), requests.memory 6Gi (4 x 1536Mi), limits.memory 6Gi (4 x 1536Mi),
      // limits.ephemeral-storage >= 14Gi (4 x 3400Mi); pods quota 5 already admits 4.
      // Memory request = limit = 1536Mi (k8s 09/11: a 420Mi request for a ~1.23 GiB build let the scheduler overcommit
      // a builder node and the kubelet evicted the pod): the scheduler books what a build uses and the pod never
      // exceeds its request. Owner decision 11/11: the builders pool stays 2 x d2-4 (1.93 GiB allocatable per node,
      // ~290Mi DaemonSets, one builder pod per node), so a 2048Mi limit risks memory pressure and evictions (10/11).
      // Only CPU overcommits (burst 4 per pod on 250m requests). 4 pods share live and build slots
      // (1 warm + 2 live/build + 1 prewarm; extra pods wait Pending, which the builder tolerates).
      resources: { requests: { cpu: '250m', memory: '1536Mi', 'ephemeral-storage': '0' },
        limits: { cpu: '4', memory: '1536Mi', 'ephemeral-storage': `${WORKER_EPHEMERAL_LIMIT_MIB}Mi` } },
      ports: [{ name: 'live', containerPort: 5173, protocol: 'TCP' }],
      volumeMounts: [{ name: 'source', mountPath: '/workspace' }, { name: 'scratch', mountPath: '/tmp' },
        { name: 'dependencies', mountPath: '/dependencies' }],
    }],
    volumes: [{ name: 'source', emptyDir: { sizeLimit: `${sizing.sourceMiB}Mi` } },
      { name: 'scratch', emptyDir: { sizeLimit: `${sizing.scratchMiB}Mi` } },
      { name: 'dependencies', emptyDir: { sizeLimit: `${sizing.dependenciesMiB}Mi` } }],
  } };
}
/** A ResourceQuota refusal of a pod creation (Kubernetes 403 « exceeded quota »): backpressure, never a failure. */
export const QUOTA_EXCEEDED = 'quota_exceeded';
export const quotaExceeded = (error: unknown) => error instanceof LiveError && error.reason === QUOTA_EXCEEDED;
export const quotaRefusal = (statusCode: number, body: string) => statusCode === 403 && /\bexceeded quota\b/.test(body);
const leaseOf = (pod: Pod) => Number(pod.metadata.labels['sentropic.dev/artifact-lease']);
interface PodTerminated { reason?: string }
interface PodContainerStatus { state?: { terminated?: PodTerminated }; lastState?: { terminated?: PodTerminated } }
interface Pod {
  metadata: { uid: string; labels: Record<string, string>; deletionTimestamp?: string; creationTimestamp?: string };
  status?: { phase?: string; reason?: string; message?: string; containerStatuses?: PodContainerStatus[] };
}
/** The pod is unusable as a worker: evicted, failed, succeeded or already terminating. An evicted pod keeps
 * its Failed object, so a phase check alone replays the 09/11 second failure. */
const podDead = (pod: Pod) => pod.metadata.deletionTimestamp !== undefined
  || pod.status?.phase === 'Failed' || pod.status?.phase === 'Succeeded';
/** Closed Kubernetes status of the runtime's pod, for loss classification and the phase log line. */
export interface PodReport {
  phase?: string; reason?: string; message?: string; deletionTimestamp?: string;
  oomkilled: boolean; creationTimestamp?: string;
}
const reportOf = (pod: Pod): PodReport => ({
  phase: pod.status?.phase, reason: pod.status?.reason, message: pod.status?.message,
  deletionTimestamp: pod.metadata.deletionTimestamp,
  oomkilled: (pod.status?.containerStatuses ?? []).some(entry =>
    entry.state?.terminated?.reason === 'OOMKilled' || entry.lastState?.terminated?.reason === 'OOMKilled'),
  creationTimestamp: pod.metadata.creationTimestamp,
});
/** Closed pod-loss causes carried in the job reason and the `artifact_live_phase` line. `pod_unavailable` is the
 * generic fallback (a dead pod the apiserver names no finer cause for); `supervisor_unresponsive` is a present
 * pod whose supervisor does not answer. */
export interface PodLoss { reason: string; detail: string }
/** Log-only k8s detail: bounded and scrubbed like a recipe tail, never ledger material. */
const K8S_DETAIL_MAX_CHARS = 512;
const k8sDetail = (value: string) => truncateRecipeTail(scrubRecipeOutput(value), K8S_DETAIL_MAX_CHARS);
export function classifyPodLoss(report: PodReport | undefined): PodLoss {
  if (!report) return { reason: 'pod_gone', detail: 'NotFound' };
  if (report.reason === 'Evicted') {
    return { reason: 'pod_evicted', detail: k8sDetail(`Evicted${report.message ? `: ${report.message}` : ''}`) };
  }
  if (report.oomkilled) return { reason: 'pod_oomkilled', detail: 'OOMKilled' };
  if (report.phase === 'Failed' || report.phase === 'Succeeded' || report.deletionTimestamp) {
    return { reason: 'pod_unavailable',
      detail: k8sDetail(`${report.phase ?? 'Terminating'}${report.reason ? `: ${report.reason}` : ''}`) };
  }
  return { reason: 'supervisor_unresponsive', detail: k8sDetail(report.phase ?? 'Unknown') };
}
/** Closed pod-loss causes, for the `artifact_live_phase` `pod` observation line. */
const POD_CAUSES = new Set(['pod_evicted', 'pod_oomkilled', 'pod_gone', 'pod_unavailable', 'supervisor_unresponsive']);
export function isPodCause(error: unknown): error is LiveError {
  return error instanceof LiveError && error.code === 'builder_unavailable' && POD_CAUSES.has(error.reason ?? '');
}
/** Transport-class `builder_unavailable` reasons: the pod or the path to it is lost, so one retry on a fresh
 * pod is safe. Deterministic failures (`install_failed:*`, `build_failed:*`, `verify*`, `publication_*`,
 * `git_*`), `pod_oomkilled` (the container exceeded its own limit; a fresh identical pod dies the same way)
 * and `phase_timeout*` (too slow, not lost) never retry. */
const RETRYABLE_REASONS = new Set(['pod_evicted', 'pod_gone', 'pod_unavailable', 'supervisor_unresponsive',
  'supervisor_relay_unreachable', 'supervisor_channel_aborted', 'k8s_unreachable', 'k8s_timeout']);
const RETRYABLE_RELAY = /^supervisor_relay_5[0-9][0-9]$/;
export function isTransportLoss(error: unknown): error is LiveError {
  return error instanceof LiveError && error.code === 'builder_unavailable'
    && (RETRYABLE_REASONS.has(error.reason ?? '') || RETRYABLE_RELAY.test(error.reason ?? ''));
}
/** Relay or channel failures whose pod-level cause can still be read from the apiserver. A clean pod
 * disappearance (`pod_missing`) already proves the pod is gone, even when a later describe cannot confirm it. */
const ENRICHABLE_RELAY = /^supervisor_relay_5[0-9][0-9]$/;
const ENRICHABLE_REASONS = new Set(['supervisor_relay_unreachable', 'supervisor_channel_aborted', 'pod_missing']);
/** Rewrites a transport failure with the Kubernetes pod cause when the apiserver names one (eviction, OOM kill,
 * gone pod, silent supervisor). Passes everything else through, including an unreadable apiserver, so a
 * `supervisor_relay_*` reason is kept exactly when no pod-level cause is known. */
export async function enrichPodLoss(deps: { describe(key: LiveKey, runtime: LiveRuntime): Promise<PodReport | undefined> },
  key: LiveKey, runtime: LiveRuntime, error: unknown): Promise<unknown> {
  if (!(error instanceof LiveError) || error.code !== 'builder_unavailable') return error;
  const reason = error.reason ?? '';
  if (!ENRICHABLE_RELAY.test(reason) && !ENRICHABLE_REASONS.has(reason)) return error;
  let report: PodReport | undefined;
  try { report = await deps.describe(key, runtime); }
  catch {
    if (reason === 'pod_missing') return new LiveError('builder_unavailable', 'pod_gone', 'NotFound');
    return error;
  }
  const loss = classifyPodLoss(report);
  // A present pod that never started (Pending) names no pod-level cause: a relay failure there is a boot race,
  // so the `supervisor_relay_*` reason is kept. Every dead, evicted, OOM-killed, gone or Running-but-silent pod
  // is rewritten with its Kubernetes cause.
  if (loss.reason === 'supervisor_unresponsive' && report?.phase !== 'Running') return error;
  return new LiveError('builder_unavailable', loss.reason, loss.detail);
}
export interface KubernetesCore {
  get<T>(resource: 'pods' | 'services', name: string): Promise<T | undefined>;
  create<T>(resource: 'pods' | 'services', value: unknown): Promise<T>;
  delete(resource: 'pods' | 'services', name: string, uid?: string): Promise<void>;
  /** Must confirm 404, not merely accept a DELETE request or a terminating phase. */
  waitDeleted(resource: 'pods' | 'services', name: string, uid?: string): Promise<void>;
}
/** Pod liveness for teardown: a gone, terminal or terminating pod never needs a supervisor quiesce. */
export type PodProbe = 'active' | 'absent' | 'terminating' | 'terminal';
export function createBuilderPods(core: KubernetesCore, bootstrap: string, placement: BuilderPlacement,
  sizing: WorkerSizing = defaultWorkerSizing()) {
  return {
    async ensure(key: LiveKey, runtime: LiveRuntime) {
      const expected = labels(key, runtime);
      let pod = await core.get<Pod>('pods', runtime.podName);
      let created = false;
      // No surge: a pod of an older lease of this binding (or a terminating one) still counts against the tenant quota.
      // A fresh intent deletes it and waits for its 404 (bounded by waitDeleted) before creating the replacement.
      if (pod && runtime.podUid === null && (leaseOf(pod) < runtime.leaseEpoch
        || (pod.metadata.deletionTimestamp && leaseOf(pod) <= runtime.leaseEpoch))) {
        if (!pod.metadata.deletionTimestamp) await core.delete('pods', runtime.podName, pod.metadata.uid);
        await core.waitDeleted('pods', runtime.podName, pod.metadata.uid);
        pod = undefined;
      }
      if (!pod) {
        if (runtime.podUid !== null) throw new LiveError('builder_unavailable', 'pod_missing');
        try { pod = await core.create<Pod>('pods', builderPod(key, runtime, bootstrap, placement, sizing)); created = true; }
        catch (error) {
          // Creation may have committed before a timeout/response loss. Discover before retrying.
          pod = await core.get<Pod>('pods', runtime.podName);
          if (!pod) throw error;
        }
      }
      if (!pod.metadata.uid || Object.entries(expected).some(([k, v]) => pod!.metadata.labels[k] !== v)
        || (runtime.podUid !== null && runtime.podUid !== pod.metadata.uid)) conflict('stale_fence');
      // A fresh intent never adopts a dead pod: the Failed object of an evicted pod stays, and adopting it replays
      // the 09/11 second failure. The replacement carries the same lease labels under a new uid. A fenced runtime
      // never replaces its own pod here: teardown owns that deletion, with the classified cause.
      if (podDead(pod)) {
        if (runtime.podUid !== null) { const loss = classifyPodLoss(reportOf(pod)); throw new LiveError('builder_unavailable', loss.reason, loss.detail); }
        if (!pod.metadata.deletionTimestamp) await core.delete('pods', runtime.podName, pod.metadata.uid);
        await core.waitDeleted('pods', runtime.podName, pod.metadata.uid);
        try { pod = await core.create<Pod>('pods', builderPod(key, runtime, bootstrap, placement, sizing)); created = true; }
        catch (error) {
          pod = await core.get<Pod>('pods', runtime.podName);
          if (!pod) throw error;
        }
        if (!pod.metadata.uid || Object.entries(expected).some(([k, v]) => pod!.metadata.labels[k] !== v)
          || (runtime.podUid !== null && runtime.podUid !== pod.metadata.uid)) conflict('stale_fence');
        if (podDead(pod) && !created) { const loss = classifyPodLoss(reportOf(pod)); throw new LiveError('builder_unavailable', loss.reason, loss.detail); }
      }
      const service = { apiVersion: 'v1', kind: 'Service', metadata: {
        name: runtime.podName, namespace: placement.namespace, labels: expected,
      }, spec: { type: 'ClusterIP', selector: expected, ports: [{ name: 'live', port: 5173, targetPort: 5173 }] } };
      const existing = await core.get<{ metadata: Pod['metadata']; spec: { selector: Record<string, string> } }>(
        'services', runtime.podName);
      if (existing && (Object.entries(expected).some(([k, v]) => existing.spec.selector[k] !== v)
        || Object.entries(expected).some(([k, v]) => existing.metadata.labels[k] !== v))) {
        // A stale ensure of an older lease must never delete the service of a newer lease (concurrent revive):
        // replace only on a fresh creation when the existing service belongs to a strictly older lease of the
        // same binding (the service name derives from the binding hash); any other divergence is a fence
        // conflict with no delete.
        const sameBinding = existing.metadata.labels['sentropic.dev/artifact-binding']
            === expected['sentropic.dev/artifact-binding']
          && existing.spec.selector['sentropic.dev/artifact-binding'] === expected['sentropic.dev/artifact-binding'];
        const leaseLabel = Number(existing.metadata.labels['sentropic.dev/artifact-lease']);
        const leaseSelector = Number(existing.spec.selector['sentropic.dev/artifact-lease']);
        const olderLease = sameBinding && Number.isFinite(leaseLabel) && Number.isFinite(leaseSelector)
          && leaseLabel < runtime.leaseEpoch && leaseSelector < runtime.leaseEpoch;
        if (runtime.podUid !== null || !olderLease) conflict('stale_fence');
        await core.delete('services', runtime.podName, existing.metadata.uid);
        await core.waitDeleted('services', runtime.podName, existing.metadata.uid);
        await core.create('services', service);
      } else if (!existing) await core.create('services', service);
      return { uid: pod.metadata.uid, adopted: !created, phase: pod.status?.phase,
        creationTimestamp: pod.metadata.creationTimestamp };
    },
    async describe(key: LiveKey, runtime: LiveRuntime): Promise<PodReport | undefined> {
      const pod = await core.get<Pod>('pods', runtime.podName);
      if (!pod) return undefined;
      if (Object.entries(labels(key, runtime)).some(([k, v]) => pod.metadata.labels[k] !== v)
        || (runtime.podUid !== null && runtime.podUid !== pod.metadata.uid)) conflict('stale_fence');
      return reportOf(pod);
    },
    async probe(key: LiveKey, runtime: LiveRuntime): Promise<PodProbe> {
      const pod = await core.get<Pod>('pods', runtime.podName);
      if (!pod) return 'absent';
      if (Object.entries(labels(key, runtime)).some(([k, v]) => pod.metadata.labels[k] !== v)
        || (runtime.podUid !== null && runtime.podUid !== pod.metadata.uid)) conflict('stale_fence');
      if (pod.status?.phase === 'Failed' || pod.status?.phase === 'Succeeded') return 'terminal';
      if (pod.metadata.deletionTimestamp) return 'terminating';
      return 'active';
    },
    async remove(key: LiveKey, runtime: LiveRuntime) {
      const pod = await core.get<Pod>('pods', runtime.podName);
      if (pod && (Object.entries(labels(key, runtime)).some(([k, v]) => pod.metadata.labels[k] !== v)
        || (runtime.podUid !== null && runtime.podUid !== pod.metadata.uid))) conflict('stale_fence');
      // A pod the apiserver already reports as gone needs no DELETE; without a known uid a delete by bare
      // name could race a concurrent session recreating this deterministic name.
      const uid = pod?.metadata.uid ?? runtime.podUid ?? undefined;
      if (uid !== undefined) {
        await core.delete('pods', runtime.podName, uid);
        await core.waitDeleted('pods', runtime.podName, uid);
      }
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
