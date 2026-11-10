import type { LiveKey, LiveRuntime } from './records';
import { LiveError } from './records';
import type { LivePorts } from './ports';
import { runPhase, withinPhase } from './deadline';

/** API-only pod adoption helpers. This module stays out of the artifact-content esbuild bundle (it pulls the
 * phase logger through `deadline`): the content entrypoint imports `pods.ts`, never this file. */
/** One `artifact_live_phase` fail line for a classified pod loss (reason + k8s detail); the job ledger and
 * `stateDetail` still carry the closed `code:reason` only. */
export async function notePodLoss(key: LiveKey, loss: LiveError): Promise<void> {
  await runPhase(key, 'pod', async () => { throw loss; }).catch(() => undefined);
}
/** An adopted pod whose supervisor answers nothing after its boot grace is never used: the pod may be lost
 * (an eviction keeps the Failed object, a wedged bootstrap keeps a Running one). */
export const ADOPTED_POD_BOOT_GRACE_MS = 60_000;
export const SUPERVISOR_PROBE_TIMEOUT_MS = 15_000;
const probeDue = (pod: { phase?: string; creationTimestamp?: string }, now: number) => {
  if (pod.phase === 'Pending') return false;
  if (!pod.creationTimestamp) return true;
  const created = Date.parse(pod.creationTimestamp);
  return !Number.isFinite(created) || now - created > ADOPTED_POD_BOOT_GRACE_MS;
};
/** `ensure` plus, for an adopted pod old enough to answer, one bounded supervisor probe (`renew`: fenced and
 * side-effect free). A silent supervisor deletes the adopted pod and recreates it inside the heavy pod slot.
 * A fence error never triggers a replacement. */
export async function ensureResponsivePod(deps: Pick<LivePorts, 'pods' | 'worker' | 'now'>, key: LiveKey,
  runtime: LiveRuntime): Promise<{ uid: string }> {
  const first = await deps.pods.ensure(key, runtime);
  if (!first.adopted || !probeDue(first, deps.now())) return { uid: first.uid };
  const probed = { ...runtime, podUid: first.uid };
  try { await withinPhase(deps.worker.renew(probed), SUPERVISOR_PROBE_TIMEOUT_MS); }
  catch (error) {
    if (!(error instanceof LiveError) || error.code !== 'builder_unavailable') throw error;
    await deps.pods.remove(key, probed);
    return { uid: (await deps.pods.ensure(key, runtime)).uid };
  }
  return { uid: first.uid };
}
