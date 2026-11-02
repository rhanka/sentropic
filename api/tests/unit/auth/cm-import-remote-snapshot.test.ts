import { describe, expect, it } from 'vitest';
import { reconcileA4RemoteSnapshot } from '../../../src/services/identity/cm-import-remote-snapshot';

const at = '2026-11-01T00:00:00.000Z';
const source = { id: 'session', user_id: 'user', session_token_hash: 'a'.repeat(64), refresh_token_hash: 'b'.repeat(64),
  created_at: '2026-10-30T12:00:00.123', expires_at: '2026-11-10T12:00:00.123', mfa_verified: true,
  device_name: null, ip_address: null, user_agent: null, last_activity_at: null };
const record = { sessionId: 'session', userId: 'user', sessionTokenHash: source.session_token_hash,
  refreshTokenHash: source.refresh_token_hash, login: { mfaVerified: true,
    authTime: Math.floor(Date.parse(`${source.created_at}Z`) / 1000), sessionVersion: Date.parse(`${source.created_at}Z`) },
  expiresAt: Date.parse(`${source.expires_at}Z`), revoked: false };

describe('A4 coherent SQL and remote snapshot', () => {
  it('should retain a durable tombstone as revoked without inventing its timestamp', () => {
    const result = reconcileA4RemoteSnapshot([source], { format: 'remote-session-projection-snapshot/1',
      records: [{ sessionId: 'session', revoked: true }] }, at);
    expect([...result.revokedSessionIds]).toEqual(['session']);
    expect(result.ownersBySessionId.get('session')).toBe('user');
    expect(result.inventory.divergence).toBe(0);
  });

  it('should reject a live orphan and any changed immutable login or token binding', () => {
    const snapshot = { format: 'remote-session-projection-snapshot/1' as const, records: [record] };
    expect(() => reconcileA4RemoteSnapshot([], snapshot, at)).toThrow('identity_import_invalid');
    expect(() => reconcileA4RemoteSnapshot([source], { ...snapshot,
      records: [{ ...record, login: { ...record.login, mfaVerified: false } }] }, at)).toThrow('identity_import_invalid');
    expect(() => reconcileA4RemoteSnapshot([source], { ...snapshot,
      records: [{ ...record, sessionTokenHash: 'c'.repeat(64) }] }, at)).toThrow('identity_import_invalid');
    expect(reconcileA4RemoteSnapshot([source], snapshot, at).inventory).toMatchObject({ files: 1, divergence: 0, orphanLive: 0 });
  });
});
