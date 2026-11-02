import { describe, expect, it } from 'vitest';
import { mapLegacyRemoteIntent } from '../../../src/services/identity/cm-import-remote';

describe('A4 pending remote intent import', () => {
  it('should preserve every distinct session and subject target with stable replay identity', async () => {
    const input = { key: 'remote_session_revocation:legacy', value: JSON.stringify({ userId: 'user', sessionIds: ['b', 'a', 'a'] }),
      at: '2026-11-01T00:00:00.000Z', resolveSessionOwner: async () => null };
    const first = await mapLegacyRemoteIntent(input), replay = await mapLegacyRemoteIntent(input);
    expect(first).toEqual(replay);
    expect(first).toHaveLength(3);
    expect(first.map(row => row.record)).toMatchObject([
      { subjectId: 'user', targetKind: 'login_session', targetRef: 'a', state: 'pending' },
      { subjectId: 'user', targetKind: 'login_session', targetRef: 'b', state: 'pending' },
      { subjectId: 'user', targetKind: 'subject', targetRef: 'user', state: 'pending' },
    ]);
  });

  it('should refuse an unprovable historical owner or a contradictory source binding', async () => {
    const input = { key: 'remote_session_revocation:legacy', at: '2026-11-01T00:00:00.000Z',
      value: JSON.stringify({ sessionIds: ['session'] }), resolveSessionOwner: async () => null };
    await expect(mapLegacyRemoteIntent(input)).rejects.toThrow('identity_import_invalid');
    await expect(mapLegacyRemoteIntent({ ...input, value: JSON.stringify({ sessionIds: ['session'], userId: 'other' }),
      resolveSessionOwner: async () => 'owner' })).rejects.toThrow('identity_import_invalid');
  });
});
