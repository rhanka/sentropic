import { describe, expect, it } from 'vitest';
import { a4MappingAssetFunctions, a4MappingAssetSha256, a4SourceFieldManifest } from '../../../src/services/identity/cm-import-manifest';
import { a4IdentitySourceTables, mapA4IdentitySource, type A4SourceSnapshot } from '../../../src/services/identity/cm-import-source';
import type { A4SourceRow } from '../../../src/services/identity/cm-import-values';
import { expectCustodyCode } from '../../utils/cm-custody-assertions';

const created = '2026-02-05T12:34:56.789';
const user = { id: 'subject', email: 'subject@example.test', role: 'editor', account_status: 'active',
  email_verified: true, display_name: null, approval_due_at: null, approved_at: null, approved_by_user_id: null,
  disabled_at: null, disabled_reason: null, created_at: created, updated_at: null };
const credential = { id: 'proof', user_id: 'subject', credential_id: 'Y3JlZA', public_key_cose: 'cHVibGlj',
  counter: 3, device_name: 'Key', transports_json: '["internal"]', uv: true, created_at: created, last_used_at: null };

const snapshot = (credentials: readonly A4SourceRow[]): A4SourceSnapshot => {
  const rows = new Map(a4IdentitySourceTables.map(table => [table, [] as readonly A4SourceRow[]]));
  rows.set('users', [user]);
  rows.set('webauthn_credentials', credentials);
  const inventory = Object.fromEntries(a4IdentitySourceTables.map(table => [table, {
    count: rows.get(table)!.length, fields: [...(a4SourceFieldManifest[table] ?? [])] }]));
  return { rows, inventory };
};
const map = (credentials: readonly A4SourceRow[], rpId: string, idpRpId: string | null) => mapA4IdentitySource(
  snapshot(credentials), { rpId, idpRpId, origins: [`https://${rpId}`], importedAt: '2026-11-09T00:00:00.000Z',
    remotelyRevokedSessionIds: new Set() });

describe('A4 import relying-party provenance', () => {
  it('should stamp the shared RP ID on every credential when the app and the IdP verify under one RP ID', async () => {
    const rows = await map([credential], 'sent-tech.ca', 'sent-tech.ca');
    const credentials = rows.flatMap(row => row.entity === 'credential' ? [row.record] : []);
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({ proofId: 'proof', rpId: 'sent-tech.ca', counter: 3 });
  });

  it('should refuse legacy credentials when the IdP RP ID differs from the app RP ID', async () => {
    await expectCustodyCode(() => map([credential], 'preprod.sentropic.sent-tech.ca', 'sent-tech.ca'),
      'identity_import_invalid');
  });

  it('should refuse legacy credentials when the IdP RP ID is not declared', async () => {
    await expectCustodyCode(() => map([credential], 'sent-tech.ca', null), 'identity_import_invalid');
  });

  it('should import a source without credentials whatever the IdP declaration', async () => {
    const rows = await map([], 'preprod.sentropic.sent-tech.ca', null);
    expect(rows.filter(row => row.entity === 'credential')).toEqual([]);
    expect(rows.filter(row => row.entity === 'account')).toHaveLength(1);
  });

  it('should bind the mapping digest to the source module that applies the mapping', () => {
    const functions = new Map(a4MappingAssetFunctions());
    expect(functions.get('mapA4IdentitySource')).toBe(Function.prototype.toString.call(mapA4IdentitySource));
    expect(functions.has('readA4IdentitySource')).toBe(true);
    expect(a4MappingAssetSha256({ rpId: 'sent-tech.ca', origins: ['https://sent-tech.ca'] })).toMatch(/^[a-f0-9]{64}$/);
  });
});
