import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRemoteSessionAuthority } from '../../../src/services/auth/remote-private-session';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'rc1-issuer-'));
  directories.push(directory);
  const store = createRemoteSessionAuthority(directory);
  const record = { sessionId: crypto.randomUUID(), userId: 'owner', sessionTokenHash: 'a'.repeat(64),
    refreshTokenHash: 'b'.repeat(64), login: { mfaVerified: true, authTime: 1800000000,
      sessionVersion: 1800000000000 }, expiresAt: 1800086400000, revoked: false };
  return { directory, store, record };
}
describe('RC1 issuer-private durable authority', () => {
  it('should serialize synchronous signing with the private revocation fence', () => {
    const { store, record } = setup();
    store.create(record);
    const login = { sub: record.userId, authTime: record.login.authTime, sessionVersion: record.login.sessionVersion };
    expect(store.signCurrent(record.sessionId, record.sessionTokenHash, login, () => 'signed')).toBe('signed');
    store.revoke(record.sessionId);
    let attempts = 0;
    expect(() => store.signCurrent(record.sessionId, record.sessionTokenHash, login, () => {
      attempts++;
      return 'signed';
    })).toThrow();
    expect(attempts).toBe(0);
  });
  it('should fence a session whose private creation finishes after bulk revocation', () => {
    const { store, record } = setup();
    store.revoke(record.sessionId);
    expect(store.find(record.sessionId)?.revoked).toBe(true);
    expect(() => store.create(record)).toThrow();
  });
  it('should retain exact login authority across a new issuer instance', () => {
    const { directory, store, record } = setup();
    store.create(record);
    expect(createRemoteSessionAuthority(directory).find(record.sessionId)).toEqual(record);
  });
  it('should preserve revocation across restart and refuse recreation from a restored shared DB row', () => {
    const { directory, store, record } = setup();
    store.create(record);
    store.revoke(record.sessionId);
    const restarted = createRemoteSessionAuthority(directory);
    expect(restarted.find(record.sessionId)?.revoked).toBe(true);
    expect(() => restarted.create(record)).toThrow();
    expect(() => restarted.rotate(record.refreshTokenHash, record)).toThrow();
  });
  it('should rotate one refresh winner and refuse mutation of signed lineage', () => {
    const { store, record } = setup();
    store.create(record);
    const next = { ...record, sessionTokenHash: 'c'.repeat(64), refreshTokenHash: 'd'.repeat(64) };
    store.rotate(record.refreshTokenHash, next);
    expect(() => store.rotate(record.refreshTokenHash, next)).toThrow();
    expect(() => store.rotate(next.refreshTokenHash, { ...next, login: { ...next.login, mfaVerified: false } })).toThrow();
  });
  it('should revoke every private session for an owner independently of the shared DB', () => {
    const { store, record } = setup();
    store.create(record);
    store.create({ ...record, sessionId: crypto.randomUUID() });
    store.revokeUser(record.userId);
    expect(store.find(record.sessionId)?.revoked).toBe(true);
  });
});
