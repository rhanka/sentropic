import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const prodSql = () => read('deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql');
const readerSql = () => read('deploy/k8s/overlays/prod/idp-identity-sync/reader-role.sql');
const importSql = () => read('deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql');
const importSh = () => read('deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sh');

describe('preprod sync replacement (a4-cm-gaps-r2 §9.2/§10.8)', () => {
  it('retained protocol SQL never writes legacy identity tables or merges counters', () => {
    const sql = importSql();
    for (const table of ['users', 'webauthn_credentials', 'user_sessions', 'webauthn_challenges', 'magic_links']) {
      for (const verb of ['INSERT INTO', 'UPDATE', 'DELETE FROM']) {
        expect(sql).not.toContain(`${verb} ${table}`);
      }
    }
    expect(sql).not.toContain('GREATEST(');
    expect(sql).not.toContain('allowed_rekey');
    expect(sql).not.toContain('rekey');
  });

  it('retained protocol SQL still converges app clients and app consents behind guards', () => {
    const sql = importSql();
    for (const include of ['client-policy.sql', 'sync-clients.sql', 'service-policy.sql', 'sync-services.sql',
      'register-workload.sql', 'client-postcondition.sql']) {
      expect(sql).toContain(include);
    }
    expect(sql).toContain('oauth_refresh_client_guard');
  });

  it('the preprod job shell has no rekey branch and maps the sync fail codes', () => {
    const sh = importSh();
    expect(sh).not.toContain('allowed_rekey');
    expect(sh).not.toContain('rekey_not_allowed');
    expect(sh).not.toContain('rekey_pairs');
    for (const code of ['invalid_manifest', 'integrity_failed', 'stale_snapshot', 'manifest_mismatch',
      'empty_export', 'identity_sync_conflict', 'identity_sync_invalid']) {
      expect(sh).toContain(code);
    }
  });

  it('the export batch carries exactly the three CM entities with no secret-bearing fields', () => {
    const script = read('api/src/scripts/identity-replica-export.ts');
    expect(script).toContain('identity-replica-batch.json');
    expect(script).toContain('snapshot.csv');
    expect(script).toContain('SHA256SUMS');
    for (const forbidden of ['token_secret', 'secret_hash', 'client_secret', 'refresh_token', 'session_token']) {
      expect(script).not.toContain(forbidden);
    }
  });

  it('the sync runner dry-runs inside a rolled-back write attempt and never touches preprod', () => {
    const script = read('api/src/scripts/identity-replica-sync.ts');
    expect(script).toContain('--dry-run');
    expect(script).toContain('rollback');
    expect(script).not.toContain('preprod');
  });

  it('the prod SQL export stays on the two app-protocol legs, never legacy identity', () => {
    const sql = prodSql();
    for (const leg of ['consents.csv', 'clients.csv', 'FROM oauth_consents',
      'FROM oauth_clients', 'idp_oauth_client_secret_presence']) {
      expect(sql).toContain(leg);
    }
    for (const legacy of ['FROM users', 'FROM webauthn_credentials', 'GREATEST(', 'rekey']) {
      expect(sql).not.toContain(legacy);
    }
  });

  it('the reader role grants the four pinned CM tables and keeps its guardrails', () => {
    const sql = readerSql();
    for (const table of ['identity_user_accounts', 'identity_account_profiles',
      'identity_webauthn_credentials', 'cm_oauth_consents']) {
      expect(sql).toContain(table);
    }
    for (const guard of ['default_transaction_read_only', 'CONNECTION LIMIT 2',
      'idp_oauth_client_secret_presence', 'REVOKE']) {
      expect(sql).toContain(guard);
    }
    expect(sql).not.toContain('GRANT SELECT ON ALL TABLES');
  });
});
