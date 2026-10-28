import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RemoteAuthorityError, remoteCounter, remoteHash, remoteId, remoteRawHash } from './remote-contract';
import { remoteCanonicalJson } from './remote-json';

const stateSchema = z.object({ sessionId: remoteId, userId: remoteId, sessionTokenHash: remoteHash,
  refreshTokenHash: remoteHash, login: z.object({ mfaVerified: z.boolean(), authTime: remoteCounter,
    sessionVersion: remoteCounter }).strict(), expiresAt: remoteCounter, revoked: z.boolean() }).strict();
export type RemoteSessionAuthority = z.infer<typeof stateSchema>;
const storedStateSchema = z.union([stateSchema,
  z.object({ sessionId: remoteId, revoked: z.literal(true) }).strict()]);
type StoredAuthority = z.infer<typeof storedStateSchema>;

// This directory is an issuer-only durable volume, never a product DB or product mount.
export function createRemoteSessionAuthority(directory: string) {
  if (!isAbsolute(directory)) throw new RemoteAuthorityError('authority_unavailable');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = (sid: string) => join(directory, `${remoteRawHash(remoteId.parse(sid))}.json`);
  function find(sid: string): StoredAuthority | null {
    const file = path(sid);
    if (!existsSync(file)) return null;
    if (statSync(file).size > 8192) throw new RemoteAuthorityError('authority_unavailable');
    const record = storedStateSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (record.sessionId !== sid) throw new RemoteAuthorityError('authority_unavailable');
    return record;
  }
  function locked<T>(sid: string, operation: () => T): T {
    const lock = `${path(sid)}.lock`;
    // A crash leaves a closed fence. Never guess that an interrupted writer did not commit.
    mkdirSync(lock, { mode: 0o700 });
    try { return operation(); } finally { rmdirSync(lock); }
  }
  function write(record: StoredAuthority): void {
    const value = storedStateSchema.parse(record);
    const file = path(value.sessionId), temporary = `${file}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(descriptor, remoteCanonicalJson(value)); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    try {
      renameSync(temporary, file);
      const parent = openSync(directory, 'r');
      try { fsyncSync(parent); } finally { closeSync(parent); }
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  function create(record: RemoteSessionAuthority): void {
    locked(record.sessionId, () => {
      if (find(record.sessionId) || record.revoked) throw new RemoteAuthorityError('replay_refused');
      write(record);
    });
  }
  function rotate(expectedRefreshHash: string, next: RemoteSessionAuthority): void {
    locked(next.sessionId, () => {
      const current = find(next.sessionId);
      if (!current || current.revoked || next.revoked || current.refreshTokenHash !== expectedRefreshHash
        || current.userId !== next.userId || remoteCanonicalJson(current.login) !== remoteCanonicalJson(next.login))
        throw new RemoteAuthorityError('authentication_required');
      write(next);
    });
  }
  function revoke(sid: string): void {
    locked(sid, () => {
      const current = find(sid);
      write(current ? { ...current, revoked: true } : { sessionId: sid, revoked: true });
    });
  }
  function revokeUser(userId: string): void {
    for (const entry of readdirSync(directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
      const file = join(directory, entry);
      if (statSync(file).size > 8192) throw new RemoteAuthorityError('authority_unavailable');
      const record = storedStateSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      if (path(record.sessionId) !== file) throw new RemoteAuthorityError('authority_unavailable');
      if ('userId' in record && record.userId === userId) revoke(record.sessionId);
    }
  }
  return { find(sid: string) {
    if (existsSync(`${path(sid)}.lock`)) throw new RemoteAuthorityError('authority_unavailable');
    return find(sid);
  }, create, rotate, revoke, revokeUser };
}

export function getRemoteSessionAuthority() {
  if (process.env.REMOTE_ACTION_ROLE !== 'auth-idp') return null;
  const directory = process.env.REMOTE_ACTION_SESSION_STATE_DIR;
  if (!directory) throw new RemoteAuthorityError('authority_unavailable');
  return createRemoteSessionAuthority(directory);
}
