import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../deploy/${path}`, import.meta.url), 'utf8');
describe('refresh authority tier boundaries', () => {
  it('should export no refresh credentials or local offline evidence', () => {
    const exported = read('k8s/overlays/prod/idp-identity-sync/export-prod.sql');
    for (const column of ['oauth_refresh_tokens', 'offline_grant_id', 'offline_scopes', 'approved_resources']) {
      expect(exported).not.toContain(column);
    }
  });
  it('should classify refresh rows as ephemeral and revoke before rekey deletion', () => {
    const imported = read('k8s/overlays/preprod/idp-identity-sync/import-preprod.sql');
    expect(imported).toContain('DELETE FROM oauth_refresh_tokens');
    expect(imported).toContain("'oauth_refresh_tokens'");
    expect(imported.indexOf('oauth_refresh_revoke_family')).toBeLessThan(imported.indexOf('DELETE FROM oauth_tokens'));
    expect(imported.indexOf('oauth_refresh_client_guard')).toBeLessThan(imported.indexOf('UPDATE users'));
  });
});
