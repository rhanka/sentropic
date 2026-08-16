import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { db } from '../../../src/db/client';
import { tenants, workspaces } from '../../../src/db/schema';

const migrationSql = readFileSync(
  join(process.cwd(), 'drizzle/control/0006_arch11_outbox_tenant_rekey.sql'),
  'utf8',
);

const suffix = crypto.randomUUID();
const tenantId = `arch11-rekey-tenant-${suffix}`;
const workspaceId = `arch11-rekey-workspace-${suffix}`;
const missingWorkspaceId = `arch11-rekey-missing-${suffix}`;
const rowIds = [`arch11-rekey-a-${suffix}`, `arch11-rekey-b-${suffix}`, `arch11-rekey-c-${suffix}`];

type StoredEnvelope = {
  tenant?: { tenantId?: string; workspaceId?: string; userId?: string };
  scope?: { tenantId?: string; workspaceId?: string };
  payload?: { previousTenantId?: string; rekeyedRows?: number };
  marker?: string;
};

describe('ARCH-11 G1a outbox tenant re-key migration', () => {
  afterEach(async () => {
    await db.run(sql`
      DELETE FROM control.event_outbox
      WHERE id IN (${rowIds[0]}, ${rowIds[1]}, ${rowIds[2]})
         OR (aggregate_type = 'tenant_rekey' AND aggregate_id = ${workspaceId})
    `);
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('re-keys only proven aliases, including embedded tenant and UBO scope copies', async () => {
    await db.insert(tenants).values({ id: tenantId, name: tenantId, status: 'active' });
    await db.insert(workspaces).values({ id: workspaceId, name: workspaceId, tenantId });

    const aliasedEnvelope = JSON.stringify({
      tenant: { tenantId: workspaceId, workspaceId, userId: 'user-a' },
      scope: { tenantId: workspaceId, workspaceId },
      marker: 'preserve-a',
    });
    const mismatchedEnvelope = JSON.stringify({
      tenant: { tenantId: 'other-tenant', workspaceId, userId: 'user-b' },
      marker: 'preserve-b',
    });
    const unresolvedEnvelope = JSON.stringify({
      tenant: { tenantId: missingWorkspaceId, workspaceId: missingWorkspaceId, userId: 'user-c' },
    });

    await db.run(sql`
      INSERT INTO control.event_outbox
        (id, aggregate_type, aggregate_id, seq, envelope, tenant_id, workspace_id, status, attempts, channel)
      VALUES
        (${rowIds[0]}, 'arch11_rekey_fixture', ${rowIds[0]}, 1, ${aliasedEnvelope}::jsonb,
          ${workspaceId}, ${workspaceId}, 'pending', 0, 'test_events'),
        (${rowIds[1]}, 'arch11_rekey_fixture', ${rowIds[1]}, 1, ${mismatchedEnvelope}::jsonb,
          ${workspaceId}, ${workspaceId}, 'pending', 0, 'test_events'),
        (${rowIds[2]}, 'arch11_rekey_fixture', ${rowIds[2]}, 1, ${unresolvedEnvelope}::jsonb,
          ${missingWorkspaceId}, ${missingWorkspaceId}, 'pending', 0, 'test_events')
    `);

    await db.execute(sql.raw(migrationSql));
    await db.execute(sql.raw(migrationSql));

    const rows = (await db.all(sql`
      SELECT id, tenant_id AS "tenantId", envelope
      FROM control.event_outbox
      WHERE id IN (${rowIds[0]}, ${rowIds[1]}, ${rowIds[2]})
      ORDER BY id
    `)) as Array<{ id: string; tenantId: string; envelope: StoredEnvelope }>;
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(rowIds[0])?.tenantId).toBe(tenantId);
    expect(byId.get(rowIds[0])?.envelope).toMatchObject({
      tenant: { tenantId, workspaceId },
      scope: { tenantId, workspaceId },
      marker: 'preserve-a',
    });
    expect(byId.get(rowIds[1])?.tenantId).toBe(tenantId);
    expect(byId.get(rowIds[1])?.envelope).toMatchObject({
      tenant: { tenantId: 'other-tenant', workspaceId },
      marker: 'preserve-b',
    });
    expect(byId.get(rowIds[2])?.tenantId).toBe(missingWorkspaceId);

    const events = (await db.all(sql`
      SELECT tenant_id AS "tenantId", envelope
      FROM control.event_outbox
      WHERE aggregate_type = 'tenant_rekey' AND aggregate_id = ${workspaceId}
    `)) as Array<{ tenantId: string; envelope: StoredEnvelope }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId,
      envelope: {
        tenant: { tenantId, workspaceId, userId: 'system:arch11-g1a' },
        payload: { previousTenantId: workspaceId, rekeyedRows: 2 },
      },
    });
  });
});
