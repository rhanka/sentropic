import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ACTIVATION_SQL_ASSET, ACTIVATION_SQL_ASSET_SHA256, ActivationCommitUnknownError } from '@sentropic/artifacts/adapters/postgres-activation';
import { runMigrations } from '../../src/db/run-migrations';
import { artifactMigrationAssets, installArtifactPackageAssets } from '../../src/services/artifacts/host-storage';
import { createArtifactHostActivationStorage } from '../../src/services/artifacts/activation-storage';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let pool: Pool;
let database: string;
const binding = { subjectId: 'reader', artifactId: 'artifact', releaseId: 'release', channel: 'stable' as const,
  nonceDigest: 'a'.repeat(64), sessionId: 'session', profileDigest: 'b'.repeat(64),
  policyRevision: 'revision', targetOrigin: 'https://artifact.example.com' };
const options = () => ({ pool, namespace: 'opaque-workspace', ticketTtlSeconds: 60, flowTtlSeconds: 30 });

beforeEach(async () => {
  database = `w1c_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  await runMigrations(pool);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await pool.end();
  await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
});
afterAll(() => admin.end());

describe('artifact host activation storage', () => {
  it('should install the unchanged activation asset through the host migration executor', async () => {
    const asset = artifactMigrationAssets.find(asset => asset.id === ACTIVATION_SQL_ASSET)!;
    expect(createHash('sha256').update(asset.read()).digest('hex')).toBe(ACTIVATION_SQL_ASSET_SHA256);
    expect((await pool.query('SELECT hash FROM public.__drizzle_control_migrations WHERE asset_id=$1',
      [ACTIVATION_SQL_ASSET])).rows).toEqual([{ hash: ACTIVATION_SQL_ASSET_SHA256 }]);
    await runMigrations(pool);
    await expect(createArtifactHostActivationStorage(options())).resolves.toBeDefined();
  });

  it('should append activation to the W1.a three-asset installation without changing earlier receipts', async () => {
    await pool.query('DROP SCHEMA artifact_host CASCADE');
    await pool.query('DELETE FROM public.__drizzle_control_migrations WHERE asset_id=$1', [ACTIVATION_SQL_ASSET]);
    const earlier = await pool.query('SELECT * FROM public.__drizzle_control_migrations ORDER BY id');
    await runMigrations(pool);
    expect((await pool.query('SELECT * FROM public.__drizzle_control_migrations WHERE asset_id IS DISTINCT FROM $1 ORDER BY id',
      [ACTIVATION_SQL_ASSET])).rows).toEqual(earlier.rows);
    await expect(createArtifactHostActivationStorage(options())).resolves.toBeDefined();
  });

  it('should refuse changed activation SQL bytes before acquiring an installer connection', async () => {
    const connect = vi.spyOn(pool, 'connect');
    await expect(installArtifactPackageAssets(pool, id => {
      const source = artifactMigrationAssets.find(asset => asset.id === id)!.read();
      return id === ACTIVATION_SQL_ASSET ? `${source}\nSELECT 1;` : source;
    })).rejects.toThrow(/asset hash mismatch/);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([0, -1, 61, 1.5, NaN, Infinity])('should refuse invalid ticket and flow lifetime %s', async ttl => {
    await expect(createArtifactHostActivationStorage({ ...options(), ticketTtlSeconds: ttl })).rejects.toThrow(/lifetime/);
    await expect(createArtifactHostActivationStorage({ ...options(), flowTtlSeconds: ttl })).rejects.toThrow(/lifetime/);
  });

  it('should refuse a flow lifetime beyond its ticket and an absent namespace', async () => {
    await expect(createArtifactHostActivationStorage({ ...options(), flowTtlSeconds: 60, ticketTtlSeconds: 30 }))
      .rejects.toThrow(/lifetime/);
    await expect(createArtifactHostActivationStorage({ ...options(), namespace: '' })).rejects.toThrow();
  });

  it.each(['missing', 'changed'])('should refuse a %s installation receipt without installing it', async damage => {
    if (damage === 'missing') await pool.query('DELETE FROM public.__drizzle_control_migrations WHERE asset_id=$1', [ACTIVATION_SQL_ASSET]);
    else await pool.query('UPDATE public.__drizzle_control_migrations SET hash=$2 WHERE asset_id=$1', [ACTIVATION_SQL_ASSET, '0'.repeat(64)]);
    await expect(createArtifactHostActivationStorage(options())).rejects.toThrow(/receipt/);
  });

  it('should issue configured lifetimes from database time and isolate the configured namespace', async () => {
    const store = await createArtifactHostActivationStorage(options());
    const other = await createArtifactHostActivationStorage({ ...options(), namespace: 'other-workspace' });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1);
    const issued = await store.issue(binding);
    clock.mockRestore();
    const { rows } = await pool.query('SELECT issued_ms::text FROM artifact_host.activation_tickets WHERE ticket_id=$1', [issued.ticket.ticketId]);
    expect(issued.ticket.expiresAt - Number(rows[0].issued_ms)).toBe(60000);
    expect(issued.flow.expiresAt - Number(rows[0].issued_ms)).toBe(30000);
    expect(await other.tickets.peek(issued.ticket.ticketId)).toBeUndefined();
    expect(await other.flows.peek(issued.flow.flowId)).toBeUndefined();
    expect(await store.flows.peek(issued.flow.flowId)).toEqual(issued.flow);
    expect(await store.consume({ ...issued.flow, expected: binding }, async () => true)).toEqual(issued.ticket);
    expect(await store.consume({ ...issued.flow, expected: binding }, async () => true)).toBeUndefined();
  });

  it('should preserve state after wrong bindings or denied authority and delegate the leased transaction', async () => {
    const store = await createArtifactHostActivationStorage(options());
    const { ticket, flow } = await store.issue(binding);
    const input = { ...flow, expected: binding };
    const denied = vi.fn(async () => false);
    expect(await store.consume({ ...input, expected: { ...binding, sessionId: 'foreign' } }, denied)).toBeUndefined();
    expect(denied).not.toHaveBeenCalled();
    expect(await store.consume(input, denied)).toBeUndefined();
    expect(await store.tickets.peek(ticket.ticketId)).toEqual(ticket);
    const restarted = await createArtifactHostActivationStorage(options());
    expect(await restarted.consume(input, async context => {
      expect(context.namespace).toBe(options().namespace);
      expect(context.ticket).toEqual(ticket);
      expect(context.flow).toEqual(flow);
      expect((await context.client.query('SELECT current_database() AS name')).rows[0].name).toBe(database);
      return true;
    })).toEqual(ticket);
  });

  it('should deny expired tickets and flows without a cleanup job', async () => {
    const store = await createArtifactHostActivationStorage({ ...options(), ticketTtlSeconds: 1, flowTtlSeconds: 1 });
    const { ticket, flow } = await store.issue(binding);
    await pool.query('SELECT pg_sleep(1.05)');
    expect(await store.tickets.peek(ticket.ticketId)).toBeUndefined();
    expect(await store.flows.peek(flow.flowId)).toBeUndefined();
    const authority = vi.fn(async () => true);
    expect(await store.consume({ ...flow, expected: binding }, authority)).toBeUndefined();
    expect(authority).not.toHaveBeenCalled();
    expect((await pool.query('SELECT count(*)::int AS count FROM artifact_host.activation_tickets')).rows[0].count).toBe(1);
  });

  it('should invalidate restored state through the package maintenance port and allow fresh issuance', async () => {
    const store = await createArtifactHostActivationStorage(options());
    const old = await store.issue(binding);
    await store.invalidate();
    expect(await store.tickets.peek(old.ticket.ticketId)).toBeUndefined();
    expect(await store.flows.peek(old.flow.flowId)).toBeUndefined();
    const fresh = await store.issue(binding);
    expect(await store.consume({ ...fresh.flow, expected: binding }, async () => true)).toEqual(fresh.ticket);
    const cleaned = await store.cleanup(1);
    expect(cleaned.flows + cleaned.tickets).toBeLessThanOrEqual(1);
  });

  it('should propagate uncertain commit outcomes and discard the leased connection', async () => {
    const store = await createArtifactHostActivationStorage(options());
    const { flow } = await store.issue(binding);
    const client = await pool.connect();
    const query = client.query.bind(client);
    const release = vi.spyOn(client, 'release');
    vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
      const result = await query(sql, values);
      if (sql === 'COMMIT') throw new Error('acknowledgement lost');
      return result;
    }) as typeof client.query);
    vi.spyOn(pool, 'connect').mockResolvedValueOnce(client as never);
    await expect(store.consume({ ...flow, expected: binding }, async () => true))
      .rejects.toBeInstanceOf(ActivationCommitUnknownError);
    expect(release).toHaveBeenCalledWith(true);
  });
});
