/**
 * Pod agent section: W3 supervisor frame verification, replay window, pod-bound fence and liveness lease.
 * - Wire frame (W3 `supervisor-frame.ts`): the 64-byte Ed25519 signature, then the exact UTF-8 JSON body
 *   `{ v: 1, id, op, fence, issuedAt, expiresAt, args }`; at most 2 MiB; delivery window ≤ 30 s; 5 s skew.
 * - Verified with the SPKI public key embedded in the pod spec, before the body is parsed or any operation
 *   runs. No secret enters the pod. An unverifiable frame gets no reply bound to its id.
 * - Replay: an id seen inside its delivery window is refused; after the window the TTL refuses it.
 * - Fence: bound to this pod's name and UID, monotonic over (generation, leaseEpoch, routeEpoch), equal
 *   epochs only for the same session.
 * - Liveness lease (A-LIVE Amendment 1 §3): any valid fenced frame renews it (op `renew` is the side-effect-free
 *   one the controller sends at least every 60 s); without one for 30 minutes the bootstrap kills
 *   the whole process tree and exits; with restartPolicy Never the pod ends and the controller applies §5.5.
 */
export const LIVENESS_LEASE_MS = 30 * 60_000;
/** Exit code after the liveness lease expired (pod phase Failed, so the lost-pod path applies). */
export const LEASE_EXIT_CODE = 3;
export const FRAME_SOURCE = String.raw`
import { verify as frameVerify } from 'node:crypto';

const FRAME = { version: 1, signature: 64, maxBytes: 2097152, ttlMs: 30000, skewMs: 5000, seen: 65536,
  leaseMs: ${LIVENESS_LEASE_MS}, leaseExit: ${LEASE_EXIT_CODE} };
const FRAME_OPS = ['phase', 'terminate', 'renew', 'clear', 'put', 'stage', 'dependencies', 'install', 'overlay', 'hostFile',
  'prebundle', 'dev', 'build', 'snapshot', 'extractArchive', 'claim', 'scrub', 'sealDependencies', 'applyOverlay'];
const FRAME_KEYS = ['v', 'id', 'op', 'fence', 'issuedAt', 'expiresAt', 'args'];
const FENCE_KEYS = ['generation', 'sessionId', 'leaseEpoch', 'routeEpoch', 'podName', 'podUid', 'poolEpoch', 'bound'];
const frameObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** The W3 reference check (openFrame) with closed keys; null means "not a supervisor frame". */
function frameOpen(publicKey, frame, now) {
  if (!(frame instanceof Uint8Array) || frame.byteLength <= FRAME.signature || frame.byteLength > FRAME.maxBytes) return null;
  const bytes = frame.subarray(FRAME.signature);
  let body;
  try {
    if (!frameVerify(null, bytes, publicKey, frame.subarray(0, FRAME.signature))) return null;
    body = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch { return null; }
  if (!frameObject(body) || Object.keys(body).some((key) => !FRAME_KEYS.includes(key)) || body.v !== FRAME.version
    || !FRAME_OPS.includes(body.op) || typeof body.id !== 'string' || !AGENT_ID.test(body.id)
    || !frameObject(body.fence) || !frameObject(body.args)
    || !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt)) return null;
  if (body.expiresAt < body.issuedAt || body.expiresAt - body.issuedAt > FRAME.ttlMs || now > body.expiresAt
    || now < body.issuedAt - FRAME.skewMs) return null;
  return body;
}
function frameFence(state, fence, identity) {
  // Pool epochs (§7.3.2 D10): absent keys mean a session-created pod (epoch 0, bound). Ordering is
  // lexicographic over (poolEpoch, bound, generation, leaseEpoch, routeEpoch), so a scrubbed pod at
  // epoch k + 1 accepts any generation while every epoch-k frame is permanently stale.
  const poolEpoch = fence.poolEpoch ?? 0;
  const bound = fence.bound ?? 1;
  if (Object.keys(fence).some((key) => !FENCE_KEYS.includes(key))
    || FENCE_KEYS.some((key) => key !== 'poolEpoch' && key !== 'bound' && !Object.hasOwn(fence, key))) {
    agentFail('fenced', 'invalid_fence');
  }
  const order = [poolEpoch, bound, fence.generation, fence.leaseEpoch, fence.routeEpoch];
  if (!order.every((n) => Number.isSafeInteger(n) && n >= 0) || bound > 1
    || typeof fence.sessionId !== 'string' || !AGENT_ID.test(fence.sessionId)) {
    agentFail('fenced', 'invalid_fence');
  }
  // Pool-fill and idle-renew frames run unbound: no session epochs may ride them.
  if (bound === 0 && (fence.generation !== 0 || fence.leaseEpoch !== 0 || fence.routeEpoch !== 0)) {
    agentFail('fenced', 'invalid_fence');
  }
  if (fence.podName !== identity.podName || fence.podUid !== identity.podUid) agentFail('fenced', 'wrong_pod');
  if (state.fence) {
    const seen = [state.fence.poolEpoch ?? 0, state.fence.bound ?? 1,
      state.fence.generation, state.fence.leaseEpoch, state.fence.routeEpoch];
    let cmp = 0;
    for (let i = 0; i < 5 && cmp === 0; i++) cmp = Math.sign(order[i] - seen[i]);
    if (cmp < 0 || (cmp === 0 && fence.sessionId !== state.fence.sessionId)) agentFail('fenced', 'stale_fence');
  }
  state.fence = { ...fence, poolEpoch, bound };
}
AGENT_SECTIONS.push(function leaseOps(ctx) {
  /** Liveness renewal (Amendment 1 §3): no side effect and never queued; the receiver renewed the lease on the fenced frame. */
  ctx.define('renew', [], async () => ({ renewed: true }), true);
});

/**
 * Warm-pool bind state (§7.3.2): an unbound pool agent accepts only pool-fill ops and `renew` — a session op
 * (`overlay`, `dev`, `build`, `snapshot`, `sealDependencies`, `applyOverlay`) is refused before it runs, so a
 * warm pod can never serve a session it was not claimed for. `claim` binds, `scrub` unbinds for the next epoch.
 */
AGENT_SECTIONS.push(function poolOps(ctx) {
  let bound = false;
  ctx.guards.push((body) => {
    if (!bound && ['overlay', 'dev', 'build', 'snapshot', 'sealDependencies', 'applyOverlay'].includes(body.op)) {
      agentFail('fenced', 'unbound_pool');
    }
  });
  ctx.define('claim', [], async (_args, fence) => {
    if ((fence.bound ?? 1) !== 1) agentFail('fenced', 'invalid_fence');
    if (bound) agentFail('failed', 'already_bound');
    bound = true;
    return { claimed: true, poolEpoch: fence.poolEpoch ?? 0 };
  });
  ctx.define('scrub', ['nextEpoch'], async (args, fence) => {
    if ((fence.bound ?? 1) !== 1) agentFail('fenced', 'invalid_fence');
    if (!bound) agentFail('failed', 'not_bound');
    if (args.nextEpoch !== (fence.poolEpoch ?? 0) + 1) agentFail('failed', 'epoch_mismatch');
    // The whole process tree is gone: a scrubbed pod keeps no session process across epochs.
    await ctx.terminateAll();
    for (const root of ['/workspace', '/tmp']) {
      const dir = ctx.at(root);
      const names = await agentFs.readdir(dir).catch(agentMissing);
      if (names === null) { await agentFs.mkdir(dir, { recursive: true }); continue; }
      for (const name of names) {
        if (root === '/tmp' && AGENT_HOST_FILES.includes(root + '/' + name)) continue;
        await agentFs.rm(dir + '/' + name, { recursive: true, force: true });
      }
    }
    // Any scrub doubt deletes the pod (§5.5): without a readable sealed tree there is no warm-deps release.
    const deps = await agentFs.readdir(ctx.at('/dependencies')).catch(agentMissing);
    if (deps === null) agentFail('integrity', 'dependencies_missing');
    bound = false;
    return { cleared: ['/workspace', '/tmp'], poolEpoch: args.nextEpoch };
  });
});
function frameReceiver(ctx, dispatch) {
  const { options, state } = ctx;
  const seen = new Map();
  let lastValid = options.now(); let expired = false;
  const encode = (reply) => Buffer.from(JSON.stringify(reply), 'utf8');
  async function receive(frame) {
    const now = options.now();
    const body = expired ? null : frameOpen(options.publicKey, frame, now);
    if (!body) return null;
    for (const [id, expiresAt] of seen) if (expiresAt < now) seen.delete(id);
    if (seen.has(body.id) || seen.size >= FRAME.seen) return null;
    seen.set(body.id, body.expiresAt);
    let reply;
    try {
      frameFence(state, body.fence, options.identity);
      lastValid = now;
      reply = { id: body.id, ok: true, data: await dispatch(body) };
    } catch (error) {
      const known = error instanceof AgentError;
      reply = { id: body.id, ok: false, code: known ? error.code : 'failed', reason: known ? error.reason : 'io_error' };
    }
    const bytes = encode(reply);
    return bytes.length <= FRAME.maxBytes ? bytes : encode({ id: body.id, ok: false, code: 'limit', reason: 'limit_exceeded' });
  }
  async function checkLease() {
    if (expired || options.now() - lastValid < (options.leaseMs ?? FRAME.leaseMs)) return false;
    expired = true;
    await ctx.terminateAll();
    options.exit(FRAME.leaseExit);
    return true;
  }
  return { receive, checkLease };
}
`;
