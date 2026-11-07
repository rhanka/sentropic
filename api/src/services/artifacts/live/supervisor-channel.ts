import type { KeyObject } from 'node:crypto';
import { conflict, LiveError, type LiveRuntime } from './records';
import { FRAME_TTL_MS, readReply, sealFrame, type FrameFence, type SupervisorOp } from './supervisor-frame';
import { putFrames, readSnapshot, treeDigest, type TransferFailure, type TransferFile, type TransferTarget,
  type TreeLimits } from './supervisor-transfer';

/** One signed frame to the pod bootstrap on worker ingress :5173, relayed by artifact-content; raw reply bytes back. */
export interface SupervisorChannel {
  send(target: { podName: string; podUid: string }, frame: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
}
export interface ChannelOptions {
  channel: SupervisorChannel;
  /** API-held Ed25519 private key; only its public half is placed in the pod spec. */
  signingKey(): KeyObject; now(): number; id(): string; timeoutMs?: number;
}
function unavailable(): never { throw new LiveError('builder_unavailable'); }
/** Maps a transfer refusal to a closed code: overflow is limit_exceeded, anything else the given code/reason. */
export const failure = (code: string, reason?: string): TransferFailure => kind => {
  if (kind === 'limit') throw new LiveError('limit_exceeded');
  throw new LiveError(code, reason);
};
const rank = (f: { generation: number; leaseEpoch: number; routeEpoch: number }) => [f.generation, f.leaseEpoch, f.routeEpoch];
function compare(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Fenced, signed, bounded command core shared by the supervisor methods and the clean installer. */
export function createSupervisorChannel(options: ChannelOptions) {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const highest = new Map<string, FrameFence>();
  const inflight = new Map<string, Set<AbortController>>();

  /** Monotonic per pod: an older fence, or the same epochs under another session or pod, is refused before sending. */
  function admit(runtime: LiveRuntime): FrameFence {
    if (!runtime.podUid) unavailable();
    const seen = highest.get(runtime.podName);
    const order = seen ? compare(rank(runtime), rank(seen)) : 1;
    if (order < 0 || (order === 0 && (seen!.sessionId !== runtime.sessionId || seen!.podUid !== runtime.podUid))) conflict('stale_fence');
    const fence = { generation: runtime.generation, sessionId: runtime.sessionId, leaseEpoch: runtime.leaseEpoch,
      routeEpoch: runtime.routeEpoch, podName: runtime.podName, podUid: runtime.podUid };
    highest.set(runtime.podName, fence);
    return fence;
  }
  /** terminate cancels every older in-flight command of the pod first; a timeout aborts the request. */
  async function call(runtime: LiveRuntime, op: SupervisorOp, args: Record<string, unknown>) {
    const fence = admit(runtime);
    if (op === 'terminate') for (const older of inflight.get(runtime.podName) ?? []) older.abort();
    const controller = new AbortController();
    const set = inflight.get(runtime.podName) ?? new Set<AbortController>();
    set.add(controller); inflight.set(runtime.podName, set);
    const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
    try {
      const id = options.id(); const issuedAt = options.now();
      const frame = sealFrame(options.signingKey(), { v: 1, id, op, fence, issuedAt, expiresAt: issuedAt + FRAME_TTL_MS, args });
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new LiveError('builder_unavailable')), { once: true });
      });
      const sending = options.channel.send({ podName: fence.podName, podUid: fence.podUid }, frame, controller.signal);
      sending.catch(() => undefined);
      return readReply(await Promise.race([sending, aborted]), id);
    } catch (error) {
      if (error instanceof LiveError) throw error;
      return unavailable(); // transport detail is never surfaced
    } finally { clearTimeout(timer); set.delete(controller); }
  }
  /** Pushes a tree in bounded put frames; the commit frame carries the digest the pod must recompute. */
  async function transfer(runtime: LiveRuntime, target: TransferTarget, files: readonly TransferFile[], limits: TreeLimits,
    fail: TransferFailure) {
    const digest = treeDigest(files, limits, fail);
    const id = options.id();
    for (const args of putFrames(id, target, files)) await call(runtime, 'put', args);
    return { transfer: id, treeDigest: digest };
  }
  const snapshot = (runtime: LiveRuntime, root: 'output' | 'dependencies', limits: TreeLimits, links: 'refuse' | 'skip',
    fail: TransferFailure) => readSnapshot(cursor => call(runtime, 'snapshot', { root, cursor }), limits, links, fail);
  return { call, transfer, snapshot, id: options.id };
}
export type SupervisorCore = ReturnType<typeof createSupervisorChannel>;
