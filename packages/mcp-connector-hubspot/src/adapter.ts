/**
 * BR-72 read-only benchmark proof — HubSpot `AppConnectorProviderAdapter`.
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
import { hubspotManifest } from './manifest.js';

let auditSequence = 0;
function nextAuditId(prefix: string): string {
  auditSequence += 1;
  return `${prefix}-${auditSequence}`;
}

export const hubspotConnectorAdapter: AppConnectorProviderAdapter = {
  appId: 'sentropic',
  connectorId: 'hubspot',
  manifest: hubspotManifest,

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
    return [...hubspotManifest.resources, ...hubspotManifest.tools, ...hubspotManifest.prompts];
  },

  async readResource(req: AppResourceRead): Promise<AppResourceResult> {
    const auditId = nextAuditId('hubspot-resource');
    await req.ctx.audit.emit({
      domain: 'hubspot',
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
    const auditId = nextAuditId('hubspot-tool');
    await req.ctx.audit.emit({ domain: 'hubspot', capabilityRef: req.capabilityRef });

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
        name: 'hubspotAccessToken',
        scope: 'principal',
        state: 'active',
      },
    ];
  },
};
