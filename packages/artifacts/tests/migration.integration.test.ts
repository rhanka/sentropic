/**
 * L-5b/5c — migration proof on disposable postgres (spec-v8 §9).
 *
 * Applies `migrations/0001_artifacts.sql` through `0005_metadata.sql` to a
 * fresh `artifacts` schema — the full upgrade path — and proves the domain
 * constraints: stable-binding uniqueness, intent kind/state guards, release
 * FK integrity, idempotency-key uniqueness, release states, access grants,
 * sources, ref holders and pins. Runs only under
 * `make test-artifacts-integration` (needs DATABASE_URL on the compose
 * network); excluded from the unit run.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('migration proof needs DATABASE_URL (make test-artifacts-integration)');
}

function migration(name: string): string {
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', name),
    'utf8',
  );
}

const client = new Client({ connectionString: DATABASE_URL });

beforeAll(async () => {
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await client.query(migration('0001_artifacts.sql'));
  await client.query(migration('0002_lifecycle.sql'));
  await client.query(migration('0003_coordinator.sql'));
  await client.query(migration('0004_terminal_controls.sql'));
  await client.query(migration('0005_metadata.sql'));
});

afterAll(async () => {
  await client.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await client.end();
});

describe('0001_artifacts migration', () => {
  it('creates the domain tables (plus the 0002-0005 upgrades applied in beforeAll)', async () => {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'artifacts' ORDER BY tablename`,
    );
    expect(rows.map((r: { tablename: string }) => r.tablename)).toEqual([
      'artifact_access',
      'artifact_current',
      'artifact_sources',
      'artifacts',
      'blob_pins',
      'blob_ref_holders',
      'blobs',
      'idempotency_keys',
      'object_intents',
      'operation_keys',
      'operation_receipts',
      'releases',
      'storage_scopes',
      'uploads',
    ]);
    // 0006_sharing is applied by the dedicated describe below, after a legacy fixture exists.
  });

  it('enforces stable-binding uniqueness', async () => {
    await client.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-1', 'org-1')`);
    await client.query(
      `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
       VALUES ('11111111-1111-4111-8111-111111111111', 'scope-1', 'owner-1', 'site')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
         VALUES ('22222222-2222-4222-8222-222222222222', 'scope-1', 'owner-1', 'site')`,
      ),
    ).rejects.toThrow(/duplicate key|23505/);
    await client.query(
      `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
       VALUES ('22222222-2222-4222-8222-222222222222', 'scope-1', 'owner-2', 'site')`,
    );
  });

  it('guards intent kind/state and release integrity', async () => {
    await expect(
      client.query(
        `INSERT INTO artifacts.object_intents (id, kind) VALUES ('33333333-3333-4333-8333-333333333333', 'hack')`,
      ),
    ).rejects.toThrow(/check constraint|23514/);
    await expect(
      client.query(
        `INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest)
         VALUES ('44444444-4444-4433-8444-444444444444', '55555555-5555-4555-8555-555555555555', 'ab', '{}')`,
      ),
    ).rejects.toThrow(/foreign key|23503|terminal artifact/);
    await client.query(
      `INSERT INTO artifacts.object_intents (id, kind, payload)
       VALUES ('33333333-3333-4333-8333-333333333333', 'commit-release', '{"a": 1}')`,
    );
    const { rows } = await client.query(
      `SELECT state FROM artifacts.object_intents WHERE id = '33333333-3333-4333-8333-333333333333'`,
    );
    expect(rows[0]?.state).toBe('pending');
  });

  it('keeps one result per idempotency key', async () => {
    await client.query(
      `INSERT INTO artifacts.idempotency_keys (key, params_hash, result)
       VALUES ('k-1', 'h-1', '{"releaseId": "r-1"}')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.idempotency_keys (key, params_hash, result)
         VALUES ('k-1', 'h-2', '{"releaseId": "r-2"}')`,
      ),
    ).rejects.toThrow(/duplicate key|23505/);
  });
});

describe('0003_coordinator migration', () => {
  it('creates the finalization tables without touching earlier objects', async () => {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'artifacts' AND tablename IN
       ('operation_keys', 'operation_receipts') ORDER BY tablename`,
    );
    expect(rows.map((r: { tablename: string }) => r.tablename)).toEqual([
      'operation_keys',
      'operation_receipts',
    ]);
  });

  it('keys coordination rows and success receipts per scope and key', async () => {
    await client.query(
      `INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key)
       VALUES ('scope-l3', 'key-1')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key)
         VALUES ('scope-l3', 'key-1')`,
      ),
    ).rejects.toThrow(/duplicate key|23505/);
    await client.query(
      `INSERT INTO artifacts.operation_receipts
         (storage_scope_id, internal_key, command_codec, command_hash, receipt)
       VALUES ('scope-l3', 'key-1', 'artifacts-command/v1', 'h-1', '{"releaseId": "r-1"}')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.operation_receipts
           (storage_scope_id, internal_key, command_codec, command_hash, receipt)
         VALUES ('scope-l3', 'key-1', 'artifacts-command/v1', 'h-2', '{"releaseId": "r-2"}')`,
      ),
    ).rejects.toThrow(/duplicate key|23505/);
  });
});

describe('0002_lifecycle migration', () => {
  it('creates the lifecycle tables', async () => {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'artifacts' AND tablename IN
       ('artifact_access', 'artifact_sources', 'blob_ref_holders', 'blob_pins') ORDER BY tablename`,
    );
    expect(rows.map((r: { tablename: string }) => r.tablename)).toEqual([
      'artifact_access',
      'artifact_sources',
      'blob_pins',
      'blob_ref_holders',
    ]);
  });

  it('guards release and artifact states', async () => {
    await client.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-9', 'org-9')`);
    await client.query(
      `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
       VALUES ('99999999-9999-4999-8999-999999999999', 'scope-9', 'owner-9', 'site')`,
    );
    const { rows } = await client.query(
      `SELECT lifecycle_state, is_public FROM artifacts.artifacts WHERE id = '99999999-9999-4999-8999-999999999999'`,
    );
    expect(rows[0]?.lifecycle_state).toBe('active');
    expect(rows[0]?.is_public).toBe(false);
    await expect(
      client.query(`UPDATE artifacts.artifacts SET lifecycle_state = 'bogus' WHERE id = '99999999-9999-4999-8999-999999999999'`),
    ).rejects.toThrow(/check constraint|23514/);
    await client.query(
      `INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state)
       VALUES ('88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999', 'ab', '{}', 'retired')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state)
         VALUES ('77777777-7777-4777-8777-777777777777', '99999999-9999-4999-8999-999999999999', 'ab', '{}', 'bogus')`,
      ),
    ).rejects.toThrow(/check constraint|23514/);
  });

  it('guards grants, sources, holders and pins', async () => {
    const artifact = '99999999-9999-4999-8999-999999999999';
    await client.query(
      `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
       VALUES ('${artifact}', 'reader-1', 'read')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
         VALUES ('${artifact}', 'reader-1', 'source')`,
      ),
    ).rejects.toThrow(/duplicate key|23505/);
    await expect(
      client.query(
        `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
         VALUES ('${artifact}', 'reader-2', 'admin')`,
      ),
    ).rejects.toThrow(/check constraint|23514/);
    await client.query(
      `INSERT INTO artifacts.artifact_sources (artifact_id, kind, commit_tx)
       VALUES ('${artifact}', 'base-commit', 'abc123')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.artifact_sources (artifact_id, kind) VALUES ('${artifact}', 'tarball')`,
      ),
    ).rejects.toThrow(/check constraint|23514/);
    await client.query(
      `INSERT INTO artifacts.blob_ref_holders (digest, holder) VALUES ('sha256:aa', 'release-r1')`,
    );
    await client.query(
      `INSERT INTO artifacts.blob_pins (digest, reason) VALUES ('sha256:aa', 'legal-hold')`,
    );
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM artifacts.blob_ref_holders WHERE digest = 'sha256:aa'`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('0006_sharing migration (G1 three-mode ACL)', () => {
  const legacyPublic = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const legacyPrivate = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const legacyMulti = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const legacyTie = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  it('applies 0006 after a legacy fixture: is_public=true maps to platform, never public, zero loss', async () => {
    // legacy state before 0006: one public artifact with grants, one private
    await client.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-g1', 'org-g1')`);
    await client.query(
      `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, is_public)
       VALUES ('${legacyPublic}', 'scope-g1', 'owner-g1', 'legacy-public', true)`,
    );
    await client.query(
      `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
       VALUES ('${legacyPrivate}', 'scope-g1', 'owner-g1', 'legacy-private')`,
    );
    await client.query(
      `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
       VALUES ('${legacyPublic}', 'reader-legacy', 'read'), ('${legacyPublic}', 'collab-legacy', 'source')`,
    );
    // legacy 0002 data with SEVERAL source grants on one artifact (direct
    // writes; MCP could only create read) — own scope so the mode assertions
    // below stay scoped to scope-g1
    await client.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-g1-dup', 'org-g1-dup')`);
    await client.query(
      `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
       VALUES ('${legacyMulti}', 'scope-g1-dup', 'owner-g1', 'legacy-multi'),
              ('${legacyTie}', 'scope-g1-dup', 'owner-g1', 'legacy-tie')`,
    );
    await client.query(
      `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission, created_at) VALUES
       ('${legacyMulti}', 'collab-new', 'source', '2026-06-01T00:00:00Z'),
       ('${legacyMulti}', 'collab-old', 'source', '2026-01-01T00:00:00Z'),
       ('${legacyMulti}', 'reader-1', 'read', '2026-02-01T00:00:00Z'),
       ('${legacyTie}', 'zeta', 'source', '2026-03-01T00:00:00Z'),
       ('${legacyTie}', 'alpha', 'source', '2026-03-01T00:00:00Z')`,
    );
    await client.query(migration('0006_sharing.sql'));

    const { rows } = await client.query<{ id: string; access_mode: string; is_public: boolean }>(
      `SELECT id, access_mode, is_public FROM artifacts.artifacts WHERE storage_scope_id = 'scope-g1' ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: legacyPublic, access_mode: 'platform', is_public: true },
      { id: legacyPrivate, access_mode: 'restricted', is_public: false },
    ]);
    // no artifact ever becomes public through the migration
    const { rows: pub } = await client.query(`SELECT COUNT(*)::int AS n FROM artifacts.artifacts WHERE access_mode = 'public'`);
    expect(pub[0]?.n).toBe(0);
    // existing grants are untouched (zero loss), including the legacy source grant
    const { rows: grants } = await client.query<{ principal_id: string; permission: string }>(
      `SELECT principal_id, permission FROM artifacts.artifact_access WHERE artifact_id = '${legacyPublic}' ORDER BY principal_id`,
    );
    expect(grants).toEqual([
      { principal_id: 'collab-legacy', permission: 'source' },
      { principal_id: 'reader-legacy', permission: 'read' },
    ]);
    // deterministic dedupe on legacy multi-source artifacts: the oldest source
    // grant (created_at, tie-break principal_id) stays source, every later
    // duplicate demotes to read — zero rows lost
    const { rows: multi } = await client.query<{ principal_id: string; permission: string }>(
      `SELECT principal_id, permission FROM artifacts.artifact_access WHERE artifact_id = '${legacyMulti}' ORDER BY principal_id`,
    );
    expect(multi).toEqual([
      { principal_id: 'collab-new', permission: 'read' },
      { principal_id: 'collab-old', permission: 'source' },
      { principal_id: 'reader-1', permission: 'read' },
    ]);
    const { rows: tie } = await client.query<{ principal_id: string; permission: string }>(
      `SELECT principal_id, permission FROM artifacts.artifact_access WHERE artifact_id = '${legacyTie}' ORDER BY principal_id`,
    );
    expect(tie).toEqual([
      { principal_id: 'alpha', permission: 'source' },
      { principal_id: 'zeta', permission: 'read' },
    ]);
    // re-applying 0006 is idempotent: the dedupe does not move again
    await client.query(migration('0006_sharing.sql'));
    const { rows: multiAgain } = await client.query<{ principal_id: string; permission: string }>(
      `SELECT principal_id, permission FROM artifacts.artifact_access WHERE artifact_id = '${legacyMulti}' ORDER BY principal_id`,
    );
    expect(multiAgain).toEqual(multi);
  });

  it('closes access_mode to the three values and defaults new rows to restricted', async () => {
    await expect(
      client.query(`UPDATE artifacts.artifacts SET access_mode = 'everyone' WHERE id = '${legacyPrivate}'`),
    ).rejects.toThrow(/check constraint|23514/);
    const { rows } = await client.query<{ access_mode: string }>(
      `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
       VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'scope-g1', 'owner-g1', 'new-one')
       RETURNING access_mode`,
    );
    expect(rows[0]?.access_mode).toBe('restricted');
  });

  it('keeps artifact_access_events append-only', async () => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO artifacts.artifact_access_events
         (artifact_id, actor_id, action, audience, principal_id, policy_revision)
       VALUES ('${legacyPrivate}', 'owner-g1', 'grant', 'user', 'reader-1', 'rev-1') RETURNING id`,
    );
    const id = rows[0]!.id;
    await expect(
      client.query(`UPDATE artifacts.artifact_access_events SET action = 'revoke' WHERE id = ${id}`),
    ).rejects.toThrow(/append-only|23514/);
    await expect(
      client.query(`DELETE FROM artifacts.artifact_access_events WHERE id = ${id}`),
    ).rejects.toThrow(/append-only|23514/);
    const { rows: kept } = await client.query(`SELECT action FROM artifacts.artifact_access_events WHERE id = ${id}`);
    expect(kept[0]?.action).toBe('grant');
  });

  it('enforces owner Q1 at the schema level: collab (source) is one named colleague, never platform-wide/public', async () => {
    // the legacy public artifact is now platform: a source grant there is refused
    await expect(
      client.query(
        `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
         VALUES ('${legacyPublic}', 'collab-2', 'source')`,
      ),
    ).rejects.toThrow(/source|23514/);
    // on a restricted artifact a source grant is allowed, but only one
    await client.query(
      `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
       VALUES ('${legacyPrivate}', 'collab-1', 'source')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
         VALUES ('${legacyPrivate}', 'collab-2', 'source')`,
      ),
    ).rejects.toThrow(/duplicate key|23505/);
    // widening the mode while a source grant exists is refused
    await expect(
      client.query(`UPDATE artifacts.artifacts SET access_mode = 'platform' WHERE id = '${legacyPrivate}'`),
    ).rejects.toThrow(/source|23514/);
    // after the collab grant is revoked, widening is allowed again
    await client.query(`DELETE FROM artifacts.artifact_access WHERE artifact_id = '${legacyPrivate}' AND principal_id = 'collab-1'`);
    await client.query(`UPDATE artifacts.artifacts SET access_mode = 'platform' WHERE id = '${legacyPrivate}'`);
    const { rows } = await client.query<{ access_mode: string }>(
      `SELECT access_mode FROM artifacts.artifacts WHERE id = '${legacyPrivate}'`,
    );
    expect(rows[0]?.access_mode).toBe('platform');
  });
});
