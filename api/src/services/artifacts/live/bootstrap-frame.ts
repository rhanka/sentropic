/**
 * Pod agent section: W3 supervisor frame verification, replay window, pod-bound fence and liveness lease.
 * - Wire frame (W3 `supervisor-frame.ts`): the 64-byte Ed25519 signature, then the exact UTF-8 JSON body
 *   `{ v: 1, id, op, fence, issuedAt, expiresAt, args }`; at most 2 MiB; delivery window ≤ 30 s; 5 s skew.
 * - Verified with the SPKI public key embedded in the pod spec, before the body is parsed or any operation
 *   runs. No secret enters the pod. An unverifiable frame gets no reply bound to its id.
 * - Replay: an id seen inside its delivery window is refused; after the window the TTL refuses it.
 * - Fence: bound to this pod's name and UID, monotonic over (generation, leaseEpoch, routeEpoch), equal
 *   epochs only for the same session.
 * - Liveness lease (A-LIVE Amendment 1 §3): without a valid fenced frame for 30 minutes the bootstrap kills
 *   the whole process tree and exits; with restartPolicy Never the pod ends and the controller applies §5.5.
 */
export const LIVENESS_LEASE_MS = 30 * 60_000;
/** Exit code after the liveness lease expired (pod phase Failed, so the lost-pod path applies). */
export const LEASE_EXIT_CODE = 3;
export const FRAME_SOURCE = String.raw`
import { verify as frameVerify } from 'node:crypto';

const FRAME = { version: 1, signature: 64, maxBytes: 2097152, ttlMs: 30000, skewMs: 5000, seen: 65536,
  leaseMs: ${LIVENESS_LEASE_MS}, leaseExit: ${LEASE_EXIT_CODE} };
const FRAME_OPS = ['phase', 'terminate', 'clear', 'put', 'stage', 'dependencies', 'install', 'overlay', 'hostFile', 'dev',
  'build', 'snapshot'];
const FRAME_KEYS = ['v', 'id', 'op', 'fence', 'issuedAt', 'expiresAt', 'args'];
const FENCE_KEYS = ['generation', 'sessionId', 'leaseEpoch', 'routeEpoch', 'podName', 'podUid'];
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
  if (Object.keys(fence).some((key) => !FENCE_KEYS.includes(key)) || FENCE_KEYS.some((key) => !Object.hasOwn(fence, key))) {
    agentFail('fenced', 'invalid_fence');
  }
  const order = [fence.generation, fence.leaseEpoch, fence.routeEpoch];
  if (!order.every((n) => Number.isSafeInteger(n) && n >= 0) || typeof fence.sessionId !== 'string' || !AGENT_ID.test(fence.sessionId)) {
    agentFail('fenced', 'invalid_fence');
  }
  if (fence.podName !== identity.podName || fence.podUid !== identity.podUid) agentFail('fenced', 'wrong_pod');
  if (state.fence) {
    const seen = [state.fence.generation, state.fence.leaseEpoch, state.fence.routeEpoch];
    let cmp = 0;
    for (let i = 0; i < 3 && cmp === 0; i++) cmp = Math.sign(order[i] - seen[i]);
    if (cmp < 0 || (cmp === 0 && fence.sessionId !== state.fence.sessionId)) agentFail('fenced', 'stale_fence');
  }
  state.fence = { ...fence };
}
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
