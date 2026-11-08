import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LiveError } from './records';
import type { LiveActor } from './authorize';
import { safeDependencyPath } from './integrity';
import { DRAFT_LIMITS, type DraftFile } from './remote-drafts';
import type { SessionInvitation } from './remote-live';

/** Closed, bounded bodies of the host live API (s-archi contract 07/11). */
const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Principals, invitation ids and package revisions: printable ASCII without spaces. */
const TOKEN = /^[\x21-\x7e]{1,256}$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MODES = new Set([0o644, 0o755]);
export const CONTROL_BYTES = 2048;
/** One page: at most 1 MiB of file bytes as base64 plus the metadata of at most 255 entries. */
export const PAGE_BYTES = 2 * 1024 * 1024;
export const SEAL_BYTES = 512 * 1024;
const STATUS: Record<string, 400 | 403 | 413 | 503> = { invalid_request: 400, access_denied: 403, limit_exceeded: 413,
  builder_unavailable: 503, dependency_cache_invalid: 503 };
export type Body = Record<string, unknown>;
export const int = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
export const token = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);
export const id = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
export const objectId = (value: unknown): value is string => typeof value === 'string' && OBJECT_ID.test(value);
export const paths = (value: unknown): value is string[] => Array.isArray(value) && value.length <= DRAFT_LIMITS.paths
  && value.every(safeDependencyPath);
/** Closed object: every required key, no unknown key. */
export function closed(value: unknown, required: string[], optional: string[] = []): value is Body {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every(k => keys.includes(k)) && keys.every(k => required.includes(k) || optional.includes(k));
}
export const limited = (maxSize: number) => bodyLimit({ maxSize, onError: c => c.json({ error: 'payload_too_large' }, 413) });
/** An over-limit body fails this read inside bodyLimit (413); only the JSON parse is caught. */
export async function json(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  try { return JSON.parse(raw) as unknown; } catch { return undefined; }
}
export const invalid = (c: Context) => c.json({ error: 'invalid_request' }, 400);
/** Closed refusal codes; anything that is not a LiveError is builder_unavailable, with no detail. */
export function refusal(c: Context, error: unknown) {
  if (!(error instanceof LiveError)) return c.json({ error: 'builder_unavailable' }, 503);
  return c.json({ error: error.code, ...(error.reason ? { reason: error.reason } : {}) }, STATUS[error.code] ?? 409);
}
export function actorOf(value: unknown): LiveActor | null {
  if (!closed(value, ['principalId'], ['invitation']) || !token(value.principalId)) return null;
  if (value.invitation === undefined) return { principalId: value.principalId };
  const i = value.invitation;
  if (!closed(i, ['id', 'epoch', 'expiresAt']) || !token(i.id) || !int(i.epoch) || !int(i.expiresAt)) return null;
  return { principalId: value.principalId, invitation: { id: i.id, epoch: i.epoch, expiresAt: i.expiresAt } };
}
/** The session invitation state of a reconcile or a grant: the host epoch and the latest active expiry (ms) or null. */
export function sessionInvitationOf(value: unknown): SessionInvitation | null {
  if (!closed(value, ['epoch', 'expiresAt']) || !int(value.epoch) || (value.expiresAt !== null && !int(value.expiresAt))) return null;
  return { epoch: value.epoch, expiresAt: value.expiresAt };
}
/** Page entries: a safe relative path, a regular file mode and canonical base64 bytes. */
export function filesOf(value: unknown): DraftFile[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > DRAFT_LIMITS.paths) return null;
  const files: DraftFile[] = [];
  for (const entry of value) {
    if (!closed(entry, ['path', 'mode', 'data']) || !safeDependencyPath(entry.path) || !MODES.has(entry.mode as number)
      || typeof entry.data !== 'string') return null;
    const bytes = Buffer.from(entry.data, 'base64');
    if (bytes.toString('base64') !== entry.data) return null;
    files.push({ path: entry.path, mode: entry.mode as number, bytes: new Uint8Array(bytes) });
  }
  return files;
}
