import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { conflict, LiveError } from './records';

/** W2 §2: the supervisor rides worker ingress TCP :5173 (relayed by artifact-content). Every frame is signed with
 * the API-held Ed25519 key; the pod verifies it with the public key from its pod spec, so no secret enters the pod. */
export const FRAME_VERSION = 1;
export const SIGNATURE_BYTES = 64;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const MAX_REPLY_BYTES = 2 * 1024 * 1024;
/** Delivery window, not a command deadline: the pod refuses a frame received after expiresAt. */
export const FRAME_TTL_MS = 30_000;
const CLOCK_SKEW_MS = 5_000;
export type SupervisorOp = 'phase' | 'terminate' | 'clear' | 'put' | 'stage' | 'dependencies' | 'install'
  | 'overlay' | 'hostFile' | 'dev' | 'build' | 'snapshot';
const OPS: ReadonlySet<string> = new Set<SupervisorOp>(['phase', 'terminate', 'clear', 'put', 'stage', 'dependencies',
  'install', 'overlay', 'hostFile', 'dev', 'build', 'snapshot']);
/** Durable controller fence plus the leased pod identity; the pod refuses any fence older than one it has seen. */
export interface FrameFence {
  generation: number; sessionId: string; leaseEpoch: number; routeEpoch: number; podName: string; podUid: string;
}
export interface FrameBody {
  v: typeof FRAME_VERSION; id: string; op: SupervisorOp; fence: FrameFence;
  issuedAt: number; expiresAt: number; args: Record<string, unknown>;
}
/** Closed pod refusal codes. Free-form pod text is never read. */
export type ReplyCode = 'fenced' | 'limit' | 'integrity' | 'failed';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function unavailable(): never { throw new LiveError('builder_unavailable'); }

/** Wire frame: the 64-byte Ed25519 signature, then the exact UTF-8 JSON body it signs. */
export function sealFrame(key: KeyObject, body: FrameBody): Uint8Array {
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') unavailable();
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  if (SIGNATURE_BYTES + bytes.length > MAX_FRAME_BYTES) throw new LiveError('limit_exceeded');
  return Buffer.concat([sign(null, bytes, key), bytes]);
}
/** Public SPKI DER (base64) for the pod spec. The private key never leaves the API. */
export function supervisorPublicKey(key: KeyObject): string {
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
}
/** Reference pod-side check for the bootstrap: signature, version, closed op and delivery window.
 * Fence monotonicity and the replay set of seen ids are pod state kept by the bootstrap. */
export function openFrame(publicKey: KeyObject, frame: Uint8Array, now: number): FrameBody | null {
  if (frame.byteLength <= SIGNATURE_BYTES || frame.byteLength > MAX_FRAME_BYTES) return null;
  const bytes = frame.subarray(SIGNATURE_BYTES);
  try {
    if (!verify(null, bytes, publicKey, frame.subarray(0, SIGNATURE_BYTES))) return null;
    const body: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!record(body) || body.v !== FRAME_VERSION || typeof body.op !== 'string' || !OPS.has(body.op)
      || typeof body.id !== 'string' || !record(body.fence) || !record(body.args)
      || !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt)) return null;
    const issuedAt = body.issuedAt as number; const expiresAt = body.expiresAt as number;
    if (expiresAt < issuedAt || expiresAt - issuedAt > FRAME_TTL_MS || now > expiresAt || now < issuedAt - CLOCK_SKEW_MS) return null;
    return body as unknown as FrameBody;
  } catch { return null; }
}
/** Bounded reply bound to the frame id; a refusal maps to a closed LiveError. */
export function readReply(bytes: Uint8Array, id: string): Record<string, unknown> {
  if (bytes.byteLength > MAX_REPLY_BYTES) unavailable();
  let reply: unknown;
  try { reply = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return unavailable(); }
  if (!record(reply) || reply.id !== id || typeof reply.ok !== 'boolean') unavailable();
  if (!reply.ok) {
    if (reply.code === 'fenced') conflict('stale_fence');
    if (reply.code === 'limit') throw new LiveError('limit_exceeded');
    if (reply.code === 'integrity') throw new LiveError('dependency_integrity_missing');
    unavailable();
  }
  return record(reply.data) ? reply.data : {};
}
