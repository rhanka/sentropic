/**
 * producer-organization-events-canary-off.test.ts — BR-60-act canary (OFF, default).
 *
 * With OUTBOX_CANARY_ORGANIZATIONS unset (the shipped default), organizations.ts
 * mutations must behave EXACTLY as before this branch: no outbox row, bespoke
 * NOTIFY only. This is the reversibility guarantee — the canary must be a no-op
 * when off.
 *
 * The env var is explicitly deleted and the module cache reset before import:
 * another file in this suite may run in the same worker and leave the flag
 * set, and a plain import would otherwise silently reuse that cached module.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createTestId } from '../utils/test-helpers';
import { createAuthenticatedUser, authenticatedRequest, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { organizations } from '../../src/db/schema';

let app: typeof import('../../src/app').app;

beforeAll(async () => {
  delete process.env.OUTBOX_CANARY_ORGANIZATIONS;
  vi.resetModules();
  ({ app } = await import('../../src/app'));
});

describe('Producer (canary OFF, default): organization_events bespoke NOTIFY only', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('does NOT write an outbox row for organization mutations', async () => {
    const suffix = createTestId();
    const user = await createAuthenticatedUser('editor', `editor-no-outbox-${suffix}@example.com`);

    const res = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Canary Off Org ${suffix}`,
      industry: 'Test',
    });
    expect(res.status).toBe(201);
    const org = await res.json();

    try {
      const rows = (await db.all(sql`
        SELECT id FROM control.event_outbox WHERE aggregate_type = 'organization' AND aggregate_id = ${org.id}
      `)) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(0);
    } finally {
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  });
});
