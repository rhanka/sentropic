import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { routePartitionHash, type RoutePartitionConfig } from '../../src/services/llm-metering/budget-admission';
import { QUALIFICATION_MODELS } from '../../src/services/llm-runtime/gw-native-qualification-plan';
import { qualificationUatMode } from '../../src/services/llm-runtime/gw-native-qualification-transport';

export const requireQualification = (ok: unknown): void => { if (!ok) throw new Error('Qualification prerequisite or case failed'); };
export const qualificationListener = 'http://ui:5173/api/v1/gw';
export const qualificationEnvironment = () => {
  requireQualification(qualificationUatMode() && process.env.LLM_GATEWAY_NATIVE_MESSAGES === 'true'
    && process.env.DISABLE_AUTH === '0' && process.env.CHAT_TRACE_ENABLED === 'false'
    && process.env.ANTHROPIC_API_KEY?.trim() && process.env.LLM_GATEWAY_UAT_SESSION_TOKEN?.trim());
  const provider = new URL(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com');
  const database = new URL(process.env.DATABASE_URL || '');
  requireQualification(provider.href === 'https://api.anthropic.com/' && database.hostname === 'postgres' && database.pathname === '/app');
  return { token: process.env.LLM_GATEWAY_UAT_SESSION_TOKEN!, database: database.href };
};
export const openQualificationDb = async (database: string) => {
  const client = new Client({ connectionString: database, options: '-c default_transaction_read_only=on -c statement_timeout=2000' });
  await client.connect(); return client;
};
export type QualificationDb = Pick<Client, 'query'>;
export type ReadinessEvidence = {
  sessionIds: string[]; generationId: string; featureSha: string; uatSha: string; edgeSha: string;
  listenerStartedAtMs: number; reaperHeartbeatAtMs: number; reaperSuccessfulPasses: number; reaperFailedPasses: number;
  secondModelsProbeAtMs: number; sourceEquivalent: boolean; imageVerified: boolean; edgeLimitsVerified: boolean;
  authorizedHeadroomMicroUsd: number;
};
const evidence = (): ReadinessEvidence => JSON.parse(readFileSync(new URL('../../../.h2a/inputs/gw-native-uat-readiness.json', import.meta.url), 'utf8'));
export const probeQualificationListener = async (token: string) => {
  for (const path of ['/healthz', '/readyz', '/v1/models']) {
    const response = await fetch(`${qualificationListener}${path}`, { headers: { authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.timeout(2_000) });
    requireQualification(response.status === 200);
    const body = await response.json();
    if (path === '/healthz') requireQualification(body.status === 'ok');
    if (path === '/readyz') requireQualification(body.status === 'ready');
    if (path === '/v1/models') requireQualification(QUALIFICATION_MODELS.every(model => body.data?.some((row: { id: string }) => row.id === model)));
  }
};
/** SELECT-only, including both N6 principals. No product app, fixture helper or cleanup hook. */
export const checkQualificationReadiness = async (db: QualificationDb, token: string, proof = evidence()) => {
  const now = Date.now();
  requireQualification([proof.featureSha, proof.uatSha, proof.edgeSha].every(sha => /^[a-f0-9]{40}$/.test(sha))
    && proof.sourceEquivalent === true && proof.imageVerified === true && proof.edgeLimitsVerified === true
    && proof.reaperSuccessfulPasses > 0 && proof.reaperFailedPasses === 0
    && proof.reaperHeartbeatAtMs >= proof.listenerStartedAtMs && proof.reaperHeartbeatAtMs <= now
    && now - proof.reaperHeartbeatAtMs <= 90_000 && proof.secondModelsProbeAtMs >= proof.listenerStartedAtMs && proof.secondModelsProbeAtMs <= now
    && proof.sessionIds.length === 2 && new Set(proof.sessionIds).size === 2);
  const sessions = (await db.query(`SELECT id, user_id FROM user_sessions WHERE id = ANY($1::text[]) AND expires_at > now()`, [proof.sessionIds])).rows;
  requireQualification(sessions.length === 2 && new Set(sessions.map(row => row.user_id)).size === 2);
  const own = (await db.query(`SELECT id FROM user_sessions WHERE session_token_hash = $1 AND expires_at > now()`,
    [createHash('sha256').update(token).digest('hex')])).rows;
  requireQualification(own.length === 1 && own[0].id === proof.sessionIds[0]);
  const memberships = (await db.query(`SELECT user_id, count(*) AS n FROM workspace_memberships WHERE user_id = ANY($1::text[]) GROUP BY user_id`,
    [sessions.map(row => row.user_id)])).rows;
  requireQualification(memberships.length === 2 && memberships.every(row => Number(row.n) === 1));
  const grants = (await db.query(`SELECT wm.user_id, w.id AS workspace_id, w.tenant_id FROM workspace_memberships wm
    JOIN workspaces w ON w.id = wm.workspace_id JOIN tenants t ON t.id = w.tenant_id
    JOIN tenant_memberships tm ON tm.tenant_id = t.id AND tm.user_id = wm.user_id
    WHERE wm.user_id = ANY($1::text[]) AND w.hidden_at IS NULL AND t.status = 'active' AND tm.status = 'approved'`,
    [sessions.map(row => row.user_id)])).rows;
  requireQualification(grants.length === 2 && sessions.every(s => grants.filter(g => g.user_id === s.user_id).length === 1)
    && new Set(grants.map(g => g.tenant_id)).size === 1
    && new Set(grants.map(g => `workspace:${g.workspace_id}:principal:${g.user_id}`)).size === 2);
  const partition = JSON.parse(process.env.LLM_GATEWAY_PARTITION || '{}') as RoutePartitionConfig;
  requireQualification(partition.hash === routePartitionHash(partition.revision, partition.tenants)
    && sessions.every(s => partition.tenants[grants[0].tenant_id]?.product?.includes(s.user_id))
    && Object.values(partition.tenants).every(p => !(p.standalone ?? []).some(id => p.product?.includes(id))));
  const cutover = (await db.query(`SELECT selected_generation_id, active_author, shadow_comparison FROM control.cluster_mesh_namespace_cutovers
    WHERE composition_root = 'product' AND namespace = '/gw' AND status = 'active'`)).rows;
  requireQualification(cutover.length === 1 && cutover[0].active_author === 'llm-gateway-module'
    && cutover[0].selected_generation_id === proof.generationId
    && cutover[0].shadow_comparison?.partition?.revision === partition.revision
    && cutover[0].shadow_comparison?.partition?.hash === partition.hash);
  const live = (await db.query(`SELECT generation_id FROM control.cluster_mesh_generations WHERE generation_id = $1
    AND status = 'active' AND supervisor_lease_expires_at > now()`, [proof.generationId])).rows;
  requireQualification(live.length === 1);
  const strategy = (await db.query(`SELECT 1 FROM control.tenant_budget_strategy WHERE tenant_id = $1
    AND funding_mode = 'tenant_pool' AND key_sourcing_mode = 'platform'`, [grants[0].tenant_id])).rows;
  const budget = (await db.query(`SELECT cap_micro_usd - spent_micro_usd - reserved_micro_usd AS available
    FROM control.budgets WHERE tenant_id = $1 AND scope_kind = 'tenant' AND reset_at > now()`, [grants[0].tenant_id])).rows;
  requireQualification(strategy.length === 1 && Number.isSafeInteger(proof.authorizedHeadroomMicroUsd)
    && proof.authorizedHeadroomMicroUsd > 0 && budget.length > 0
    && budget.every(row => BigInt(row.available) >= BigInt(proof.authorizedHeadroomMicroUsd)));
  const pricing = (await db.query(`SELECT model_id FROM control.model_pricing WHERE provider_id = 'anthropic'
    AND model_id = ANY($1::text[]) AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())`, [QUALIFICATION_MODELS])).rows;
  requireQualification(QUALIFICATION_MODELS.every(model => pricing.filter(row => row.model_id === model).length === 1));
  await probeQualificationListener(token);
  return { cutoverMatches: true, partitionMatches: true, distinctPrincipals: true, pricingModels: pricing.length };
};
