/**
 * BR-72 Wave-1 benchmark proof — Airtable `AppConnectorProviderAdapter`.
 *
 * READ-ONLY ONLY. `readResource`/`invokeTool` never call `ctx.getSecret` (no
 * real network call is ever made — every result comes from the in-repo
 * SYNTHETIC fixtures in `./fixtures.ts`). `validateSecrets` returns state
 * only, never a secret value. Recoded independently against the Sentropic
 * `@sentropic/mcp-platform` contract (`../../mcp-platform/src/runtime.ts`);
 * not the production connector (production connector residence is an
 * architect D4 decision, deferred).
 */
import type {
  AppCapability,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
} from '../../mcp-platform/src/manifest.js';
import type {
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
  ConnectorSecretStatus,
  DurableCallRef,
} from '../../mcp-platform/src/runtime.js';
import { getResourceFixture, getToolFixture } from './fixtures.js';
import { airtableManifest } from './manifest.js';

let auditSequence = 0;
function nextAuditId(prefix: string): string {
  auditSequence += 1;
  return `${prefix}-${auditSequence}`;
}

export const airtableConnectorAdapter: AppConnectorProviderAdapter = {
  appId: 'sentropic',
  connectorId: 'airtable',
  manifest: airtableManifest,

  async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
    // Narrow-only: echo the core-authorized scoping, never broaden it.
    return {
      principalRef: input.principalSub,
      tenantRef: input.tenantRef,
      workspaceRef: input.workspaceRef,
      connectorInstanceId: input.connectorInstanceId,
    };
  },

  async listCapabilities(_ctx: ConnectorTenantContext): Promise<AppCapability[]> {
    return [...airtableManifest.resources, ...airtableManifest.tools, ...airtableManifest.prompts];
  },

  async readResource(req: AppResourceRead): Promise<AppResourceResult> {
    const auditId = nextAuditId('airtable-resource');
    await req.ctx.audit.emit({
      domain: 'airtable',
      capabilityRef: req.capabilityRef,
      uri: req.input.uri,
    });

    const fixture = getResourceFixture(req.capabilityRef);
    if (fixture === undefined) {
      return {
        ok: false,
        auditId,
        redactionClass: 'low',
        error: {
          code: 'unknown_resource',
          message: `No synthetic fixture registered for resource "${req.capabilityRef}".`,
          retriable: false,
        },
      };
    }

    return { ok: true, output: fixture, auditId, redactionClass: 'low' };
  },

  async invokeTool(req: AppToolInvocation): Promise<AppToolResult | DurableCallRef> {
    const auditId = nextAuditId('airtable-tool');
    await req.ctx.audit.emit({ domain: 'airtable', capabilityRef: req.capabilityRef });

    const fixture = getToolFixture(req.capabilityRef);
    if (fixture === undefined) {
      return {
        ok: false,
        auditId,
        redactionClass: 'none',
        error: {
          code: 'unknown_tool',
          message: `No synthetic fixture registered for tool "${req.capabilityRef}".`,
          retriable: false,
        },
      };
    }

    return { ok: true, output: fixture, auditId, redactionClass: 'none' };
  },

  async validateSecrets(_ctx: ConnectorTenantContext): Promise<ConnectorSecretStatus> {
    // State only — the raw secret VALUE is never disclosed here.
    return [
      {
        name: 'airtablePersonalAccessToken',
        scope: 'connector-instance',
        state: 'active',
      },
    ];
  },
};
