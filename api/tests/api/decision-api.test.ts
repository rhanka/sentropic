import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { jevDescriptor } from '@sentropic/llm-mesh/decision/host';
import { decisionRequest } from '../../../packages/llm-mesh/tests/decision-fixtures';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

const path = '/api/v1/llm-mesh/decision';
const clearCutover = () => db.execute(sql`DELETE FROM control.cluster_mesh_namespace_cutovers
  WHERE composition_root = 'product' AND namespace = '/llm-mesh'`);

describe('Decision route through the actual product cluster-mesh composition', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
    await db.execute(sql`INSERT INTO tenant_memberships (tenant_id, user_id, status)
      SELECT tenant_id, ${user.id}, 'approved' FROM workspaces WHERE id = ${user.workspaceId}
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET status = 'approved'`);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Fixture forbids external requests'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.execute(sql`DELETE FROM control.decision_calls WHERE principal_key = ${user.id}`);
    await clearCutover();
    await cleanupAuthData();
  });
  it('should require authentication on the mounted route', async () => {
    const response = await app.request(path, { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('should apply the exact consolidated Decision migration through the control migration mechanism', async () => {
    const hash = createHash('sha256').update(readFileSync('drizzle/control/0012_decision_host.sql')).digest('hex');
    expect((await db.execute(sql`SELECT hash FROM public.__drizzle_control_migrations WHERE hash = ${hash}`)).rows).toHaveLength(1);
  });
  it.each(['tenant', 'workspace'])('should refuse revoked %s authority before service admission', async (authority) => {
    if (authority === 'tenant') await db.execute(sql`UPDATE tenant_memberships SET status = 'suspended' WHERE user_id = ${user.id}`);
    else await db.execute(sql`UPDATE workspace_memberships SET role = 'viewer' WHERE user_id = ${user.id}`);
    const response = await authenticatedRequest(app, 'POST', path, user.sessionToken!, decisionRequest({ evaluator: jevDescriptor.evaluator }));
    expect(response.status).toBe(403);
    expect((await db.execute(sql`SELECT id FROM control.budget_holds WHERE principal_key = ${user.id}`)).rows).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('should discover both unavailable production evaluators without provider access', async () => {
    const response = await authenticatedRequest(app, 'GET', path, user.sessionToken!);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ profile: 'production', productionReady: false });
    expect(body.evaluators).toHaveLength(2);
    expect(body.evaluators.map((entry) => entry.evaluator.providerId).sort()).toEqual(['openai', 'typesafe']);
    expect(body.evaluators.every((entry) => entry.availability === 'unavailable' && entry.identityQualified === false)).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('should persist the production refusal without dispatch or a budget hold', async () => {
    const response = await authenticatedRequest(app, 'POST', path, user.sessionToken!,
      decisionRequest({ evaluator: jevDescriptor.evaluator }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' },
      receipt: { attempts: 0, budget: { state: 'not-admitted' } } });
    expect((await db.execute(sql`SELECT id FROM control.budget_holds WHERE principal_key = ${user.id}`)).rows).toHaveLength(0);
    expect((await db.execute(sql`SELECT call_id FROM control.decision_calls WHERE principal_key = ${user.id}`)).rows).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('should reject a request-selected qualification profile', async () => {
    const response = await authenticatedRequest(app, 'POST', path, user.sessionToken!,
      { ...decisionRequest({ evaluator: jevDescriptor.evaluator }), executionProfile: 'qualification' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'REQUEST_INVALID' } });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
