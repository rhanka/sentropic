import type { KeyObject } from 'node:crypto';
import { conflict, LiveError, type LiveRuntime } from './records';
import { FRAME_TTL_MS, readReply, sealFrame, type FrameFence, type SupervisorOp } from './supervisor-frame';
import { entryOf, manifestDigest, putWriter, readSnapshot, streamSnapshot, treeDigest, type PutFrame, type TransferEntry,
  type TransferFailure, type TransferFile, type TransferTarget, type TreeLimits } from './supervisor-transfer';

/** One signed frame to the pod bootstrap on worker ingress :5173, relayed by artifact-content; raw reply bytes back. */
export interface SupervisorChannel {
  send(target: { podName: string; podUid: string }, frame: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
}
export interface ChannelOptions {
  channel: SupervisorChannel;
  /** API-held Ed25519 private key; only its public half is placed in the pod spec. */
  signingKey(): KeyObject; now(): number; id(): string; timeoutMs?: number;
}
/** Per-call bounds of one supervisor tree operation: `signal` cuts a hung or superseded command, `onProgress`
 * fires once per sent frame or drained page so a stall watchdog observes large transfers. */
export interface SupervisorCallOptions { signal?: AbortSignal; onProgress?: () => void }
function unavailable(): never { throw new LiveError('builder_unavailable', 'supervisor_channel_error'); }
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

/** Pipelined put window (§7.2.1): up to 8 signed put frames in flight, each still individually fenced and
 * acknowledged by `(transfer id, frame seq)`. */
export const PIPELINE_WINDOW = 8;
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
  async function call(runtime: LiveRuntime, op: SupervisorOp, args: Record<string, unknown>,
    callOptions: Pick<SupervisorCallOptions, 'signal'> = {}) {
    const fence = admit(runtime);
    if (op === 'terminate') for (const older of inflight.get(runtime.podName) ?? []) older.abort();
    const controller = new AbortController();
    const onExternal = () => controller.abort();
    if (callOptions.signal) {
      if (callOptions.signal.aborted) controller.abort();
      else callOptions.signal.addEventListener('abort', onExternal, { once: true });
    }
    const set = inflight.get(runtime.podName) ?? new Set<AbortController>();
    set.add(controller); inflight.set(runtime.podName, set);
    const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
    try {
      const id = options.id(); const issuedAt = options.now();
      const frame = sealFrame(options.signingKey(), { v: 1, id, op, fence, issuedAt, expiresAt: issuedAt + FRAME_TTL_MS, args });
      const aborted = new Promise<never>((_resolve, reject) => {
        // An already-aborted signal never fires a later listener, so a pre-aborted call must reject at once.
        if (controller.signal.aborted) reject(new LiveError('builder_unavailable', 'supervisor_channel_aborted'));
        else controller.signal.addEventListener('abort', () => reject(new LiveError('builder_unavailable', 'supervisor_channel_aborted')), { once: true });
      });
      const sending = options.channel.send({ podName: fence.podName, podUid: fence.podUid }, frame, controller.signal);
      sending.catch(() => undefined);
      return readReply(await Promise.race([sending, aborted]), id);
    } catch (error) {
      if (error instanceof LiveError) throw error;
      return unavailable(); // transport detail is never surfaced
    } finally { clearTimeout(timer); set.delete(controller); callOptions.signal?.removeEventListener('abort', onExternal); }
  }
  /** Pipelined tree stream (§7.2.1): same frames, limits and digest as `stream`, but up to `PIPELINE_WINDOW`
   * puts in flight. A refused frame fails the whole transfer with its closed refusal; later frames are never
   * sent after the first failure. */
  async function streamPipelined(runtime: LiveRuntime, target: TransferTarget,
    files: AsyncIterable<TransferFile> | Iterable<TransferFile>, limits: TreeLimits, fail: TransferFailure,
    streamOptions: SupervisorCallOptions = {}) {
    const id = options.id(); const writer = putWriter(id, target);
    const entries: TransferEntry[] = []; let total = 0;
    const inFlight = new Set<Promise<unknown>>();
    let failure: unknown;
    async function send(frame: PutFrame) {
      if (failure !== undefined) throw failure;
      streamOptions.signal?.throwIfAborted();
      const run = call(runtime, 'put', frame as unknown as Record<string, unknown>, streamOptions)
        .then(() => { streamOptions.onProgress?.(); });
      inFlight.add(run);
      void run.then(() => { inFlight.delete(run); }, error => { inFlight.delete(run); failure ??= error; });
      while (inFlight.size >= PIPELINE_WINDOW && failure === undefined) await Promise.race(inFlight);
      if (failure !== undefined) throw failure;
    }
    for await (const file of files) {
      if (failure !== undefined) throw failure;
      streamOptions.signal?.throwIfAborted();
      const entry = entryOf(file, fail); total += entry.size;
      if (entries.length >= limits.files || entry.size > limits.fileBytes || total > limits.totalBytes) fail('limit');
      entries.push(entry);
      for (const frame of writer.add(file)) await send(frame);
    }
    for (const frame of writer.end()) await send(frame);
    await Promise.allSettled(inFlight);
    if (failure !== undefined) throw failure;
    return { transfer: id, treeDigest: manifestDigest(entries, limits, fail) };
  }
  /** Streams a tree file by file into bounded put frames, holding one file and one frame. Per-file and running limits
   * refuse as soon as they overflow; the whole tree is checked before the digest that the commit frame carries, so a
   * refused or interrupted tree is never committed. */
  async function stream(runtime: LiveRuntime, target: TransferTarget, files: AsyncIterable<TransferFile> | Iterable<TransferFile>,
    limits: TreeLimits, fail: TransferFailure, streamOptions: SupervisorCallOptions = {}) {
    const id = options.id(); const writer = putWriter(id, target);
    const entries: TransferEntry[] = []; let total = 0;
    for await (const file of files) {
      streamOptions.signal?.throwIfAborted();
      const entry = entryOf(file, fail); total += entry.size;
      if (entries.length >= limits.files || entry.size > limits.fileBytes || total > limits.totalBytes) fail('limit');
      entries.push(entry);
      for (const args of writer.add(file)) { await call(runtime, 'put', args, streamOptions); streamOptions.onProgress?.(); }
    }
    for (const args of writer.end()) { await call(runtime, 'put', args, streamOptions); streamOptions.onProgress?.(); }
    return { transfer: id, treeDigest: manifestDigest(entries, limits, fail) };
  }
  /** An in-memory tree is refused as a whole before its first put frame. */
  async function transfer(runtime: LiveRuntime, target: TransferTarget, files: readonly TransferFile[], limits: TreeLimits,
    fail: TransferFailure, transferOptions: SupervisorCallOptions = {}) {
    treeDigest(files, limits, fail);
    return stream(runtime, target, files, limits, fail, transferOptions);
  }
  const snapshot = (runtime: LiveRuntime, root: 'output' | 'dependencies', limits: TreeLimits, links: 'refuse' | 'skip',
    fail: TransferFailure) => readSnapshot(cursor => call(runtime, 'snapshot', { root, cursor }), limits, links, fail);
  /** Streaming read: each finished file goes to `sink` before the next page is requested. */
  const drain = (runtime: LiveRuntime, root: 'dependencies', limits: TreeLimits, links: 'skip', fail: TransferFailure,
    sink: (file: TransferFile) => Promise<void>, drainOptions: SupervisorCallOptions = {}) =>
    streamSnapshot(cursor => call(runtime, 'snapshot', { root, cursor }, drainOptions), limits, links, fail, sink,
      drainOptions.onProgress);
  return { call, transfer, stream, streamPipelined, snapshot, drain, id: options.id };
}
export type SupervisorCore = ReturnType<typeof createSupervisorChannel>;
