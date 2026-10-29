import { randomUUID } from 'node:crypto';
import { MEMORY_PROVIDER_MANIFEST, type McpMemoryProviderOptions } from '@sentropic/engram/mcp-memory';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import { createEngramMemoryBuiltin, type EngramMemoryDefinitionOptions } from '../../src/integrations/mcp/memory.js';
import { createModuleRegistry } from '../../src/modules/registry.js';
import { createMcpRegistry } from '../../src/mcp/registry.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { assembleMemoryHostBinding } from '../../src/engram-memory/binding.js';
import { grantFor } from '../storage/authority-corpus.js';
import { memoryHostProvider, memoryPgHost } from './pg-host.js';
import { mcpDependencies, clock, DEADLINE, D } from './mcp-dependencies.js';
import { mcpRecovery } from './mcp-recovery.js';
import { mcpContext } from './mcp-context.js';
export { captureInput } from './mcp-dependencies.js';

export async function memoryMcpDefinition(tenant = 'tenant-a') {
  if (!process.env.CM_PG_URL) throw new Error('memory MCP qualification requires real PostgreSQL via CM_PG_URL');
  const pg = await memoryPgHost();
  const scope = { tenantId: tenant, workspaceId: 'workspace-memory' };
  const scopeRef = `scope-${tenant}`, storeId = `store-${tenant}`;
  const binding = assembleMemoryHostBinding({ driver: memoryHostProvider(pg.options.driver),
    maintainGrant: grantFor({ token: `maintain-${tenant}`, moduleId: 'engram-memory', scope,
      operations: ['read', 'maintain'], principalId: 'user-memory' }), invocationId: 'inv-memory', storeId });
  const kernel = await createPostgresKernel({ ...pg.options, canonicalOwnership: { leaseMs: 30000 } });
  await kernel.bindNew(binding.maintainGrant); await kernel.bindNew(binding.memoryGrant);
  let approved = true, sequence = 0;
  const authenticate = async (ctx: { tenant_id: string; scope_ref: string; store_id: string; authorization: { credential: string } }) =>
    ctx.tenant_id === tenant && ctx.scope_ref === scopeRef && ctx.store_id === storeId && ctx.authorization.credential === `credential-${tenant}`;
  const pages = new Map<string, any>();
  const readHost: McpMemoryProviderOptions['readHost'] = { clock, authenticate,
    authorize: async (ctx, _tool, purpose) => await authenticate(ctx) && purpose === 'purpose-memory',
    authorizeContinuation: async (_page, ctx) => authenticate(ctx),
    pages: { issue: async state => { const id = randomUUID(); pages.set(id, state); return id; },
      load: async id => pages.get(id), dispose: async id => { pages.delete(id); } } };
  const writeHost: McpMemoryProviderOptions['writeHost'] = { clock, authenticate,
    authorize: async ctx => authenticate(ctx), reservation: await mcpRecovery(pg),
    audit: { append: async entry => { await pg.tx.run(false, session => session.execute({
      text: `INSERT INTO "${pg.name}".mcp_audit(entry) VALUES($1::jsonb)`, values: [JSON.stringify(entry)] })); } },
    policy: { capturePolicyVersion: async () => 'capture-policy-v1', admissionPolicyVersion: async () => '1',
      retention: { max_retention_days: 30, allow_retain_derivative_rule: false }, reconciliation: { consented_family_refs: [] },
      anchorKindRef: 'memory-lifecycle', provenanceDigest: async () => D,
      nextSourceOrder: async () => ({ source_ref: 'source-memory', sequence: String(++sequence) }) },
    confirm: async bound => approved && bound.elicitation_ref === 'elicitation-memory',
    keyCustody: { confirmDestroyed: async () => true }, coverage: { verify: async () => ({ complete: false }) } };
  await pg.tx.run(false, session => session.execute({ text: `CREATE TABLE "${pg.name}".mcp_audit(entry jsonb NOT NULL)`, values: [] }));
  const descriptors = structuredClone(MEMORY_PROVIDER_MANIFEST.tools);
  const plan = Object.freeze({ resolveTool: (name: string) => {
    const tool = descriptors.find(t => t.name === name);
    return tool ? { providerId: 'sentropic.engram.memory', capabilityName: name,
      requiredScopes: tool.requiredScopes, requiredClaims: tool.requiredClaims, entry: { gates: tool.gates } } : undefined;
  } });
  const definition: EngramMemoryDefinitionOptions = {
    activation: { hostEnabled: true, tenantEnabled: true, persisted: true },
    storage: { kernel, binding, driver: pg.options.driver, schemaName: pg.name, scope },
    scopeBinding: { scope, store_id: storeId, resolveScope: ref => ref === scopeRef ? scope : null },
    scopeRef, deadlineAt: DEADLINE, engineId: `engine-${tenant}`, dependencies: mcpDependencies(scopeRef),
    provider: { readHost, writeHost, plan, policyId: 'memory-test-policy', sourceId: 'mcp:engram-memory', generation: '1' },
    hostBindings: { hostBindingRef: 'host-memory', invocation: { contractVersion: '1.0.0' }, authorization: { contractVersion: '1.0.0' },
      domainPolicy: { contractVersion: '1.0.0' }, mutationRecovery: { contractVersion: '1.0.0', digestProfile: 'sentropic.engram.memory-mutation/v1' },
      confirmation: { contractVersion: '1.0.0', enrolledOidcDomain: 'sent-tech.ca' }, audit: { contractVersion: '1.0.0' },
      pagination: { contractVersion: '1.0.0', engramOwnsSigningSecret: false }, lifecycle: { contractVersion: '1.0.0' } },
    provenance: { approvalRef: 'memory-test-approval', revision: '1', reviewedBy: ['memory-test-owner'] },
  };
  return { definition, context: (args = {}) => mcpContext(tenant, scopeRef, storeId, args),
    confirm: (value: boolean) => { approved = value; }, close: () => pg.close() };
}

export async function memoryMcpHost(tenant = 'tenant-a') {
  const host = await memoryMcpDefinition(tenant);
  const { definition } = host;
  const modules = createModuleRegistry();
  const builtin = createEngramMemoryBuiltin({ modules, definition });
  const registry = createMcpRegistry({ modules, builtins: [builtin] });
  registry.select(['sentropic.engram.memory']);
  registry.configure('sentropic.engram.memory', { mode: 'embedded-local', hostBindingRef: 'host-memory' });
  const result = await registry.compile({ bindings: {}, compatibility: {
    'sentropic.engram.memory': { manifestDigest: computeManifestDigest(MEMORY_PROVIDER_MANIFEST) } } });
  if (!result.ok) { await builtin.runtime()?.close(); await definition.storage.kernel.ownership?.release(); await host.close();
    throw new Error(JSON.stringify(result.diagnostics)); }
  const runtime = builtin.runtime()!;
  return { runtime, builtin, registry, modules, definition, manifest: MEMORY_PROVIDER_MANIFEST,
    context: host.context,
    call: (tool: string, args: any) => runtime.server.callTool(tool, args, host.context(args),
      { idempotencyKey: args.idempotency_key, elicitationRef: 'elicitation-memory' }),
    confirm: host.confirm,
    close: async () => { await runtime.close(); await host.close(); },
  };
}
