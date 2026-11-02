import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { invalidA4Import, sourceText, type A4SourceRow } from './cm-import-values';
import { mapA4Login } from './cm-import-mapping';

const id = z.string().min(1).max(256), hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const full = z.object({ sessionId: id, userId: id, sessionTokenHash: hash, refreshTokenHash: hash,
  login: z.object({ mfaVerified: z.boolean(), authTime: counter, sessionVersion: counter }).strict(),
  expiresAt: counter, revoked: z.boolean() }).strict();
const schema = z.object({ format: z.literal('remote-session-projection-snapshot/1'),
  records: z.array(z.union([full, z.object({ sessionId: id, revoked: z.literal(true) }).strict()])) }).strict();
export type A4RemoteSnapshot = z.infer<typeof schema>;

export async function loadA4RemoteSnapshot(path: string): Promise<A4RemoteSnapshot> {
  let decoded: unknown;
  try { decoded = JSON.parse(await readFile(path, 'utf8')); } catch { return invalidA4Import(); }
  const result = schema.safeParse(decoded);
  return result.success ? result.data : invalidA4Import();
}

/** Compare protected file state with the SQL bindings without publishing row material. */
export function reconcileA4RemoteSnapshot(source: readonly A4SourceRow[], snapshot: A4RemoteSnapshot, importedAt: string) {
  const sql = new Map(source.map(row => [sourceText(row.id), mapA4Login(row, importedAt)]));
  const revoked = new Set<string>(), owners = new Map<string, string>(), seen = new Set<string>();
  for (const [sessionId, session] of sql) owners.set(sessionId, session.userId);
  for (const record of snapshot.records) {
    if (seen.has(record.sessionId)) return invalidA4Import();
    seen.add(record.sessionId);
    const session = sql.get(record.sessionId);
    if (record.revoked) revoked.add(record.sessionId);
    if ('userId' in record) {
      owners.set(record.sessionId, record.userId);
      if (!session) { if (!record.revoked) return invalidA4Import(); continue; }
      if (record.userId !== session.userId || record.sessionTokenHash !== session.sessionTokenHash
        || record.refreshTokenHash !== session.refreshTokenHash || record.expiresAt !== Date.parse(session.expiresAt)
        || record.login.mfaVerified !== session.login.mfaVerified || record.login.authTime !== session.login.authTime
        || record.login.sessionVersion !== session.login.sessionVersion) return invalidA4Import();
    } else if (!record.revoked) return invalidA4Import();
  }
  return { revokedSessionIds: revoked, ownersBySessionId: owners,
    inventory: { files: seen.size, revoked: revoked.size, missingProjection: [...sql.keys()].filter(id => !seen.has(id)).length,
      orphanRevoked: [...revoked].filter(id => !sql.has(id)).length, divergence: 0, orphanLive: 0 } };
}
