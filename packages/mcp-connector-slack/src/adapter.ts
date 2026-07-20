/**
 * BR-72 Wave-1 benchmark proof — Slack `AppConnectorProviderAdapter`.
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
import { slackManifest } from './manifest.js';

let auditSequence = 0;
function nextAuditId(prefix: string): string {
  auditSequence += 1;
  return `${prefix}-${auditSequence}`;
}

export const slackConnectorAdapter: AppConnectorProviderAdapter = {
  appId: 'sentropic',
  connectorId: 'slack',
  manifest: slackManifest,

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
    return [...slackManifest.resources, ...slackManifest.tools, ...slackManifest.prompts];
  },

  async readResource(req: AppResourceRead): Promise<AppResourceResult> {
    const auditId = nextAuditId('slack-resource');
    await req.ctx.audit.emit({
      domain: 'slack',
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
    const auditId = nextAuditId('slack-tool');
    await req.ctx.audit.emit({ domain: 'slack', capabilityRef: req.capabilityRef });

    const fixture = getToolFixture(req.capabilityRef);
    if (fixture === undefined) {
      return {
        ok: false,
        auditId,
        redactionClass: 'moderate',
        error: {
          code: 'unknown_tool',
          message: `No synthetic fixture registered for tool "${req.capabilityRef}".`,
          retriable: false,
        },
      };
    }

    return { ok: true, output: fixture, auditId, redactionClass: 'moderate' };
  },

  async validateSecrets(_ctx: ConnectorTenantContext): Promise<ConnectorSecretStatus> {
    // State only — the raw secret VALUE is never disclosed here.
    return [
      {
        name: 'slackAccessToken',
        scope: 'principal',
        state: 'active',
      },
    ];
  },
};
