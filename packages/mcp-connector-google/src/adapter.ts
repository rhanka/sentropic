/** Hermetic adapters for the two Google OAuth-backed read-only providers. */
import type {
  AppCapability,
  AppMcpProviderManifest,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
  RedactionClass,
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
  ConnectorSecretStatus,
  DurableCallRef,
} from '@sentropic/mcp-platform';
import { getResourceFixture, getToolFixture, type GoogleProvider } from './fixtures.js';
import { gmailManifest, googleDriveManifest } from './manifest.js';

let auditSequence = 0;

function nextAuditId(provider: GoogleProvider, kind: 'resource' | 'tool'): string {
  auditSequence += 1;
  return `${provider}-${kind}-${auditSequence}`;
}

/**
 * Multi-account mounting is represented by a distinct connectorInstanceId for
 * each Google account. Workspace segmentation remains on ConnectorEnrollment.workspaceRef.
 */
export function mountedConnectorId(provider: GoogleProvider, connectorInstanceId: string): string {
  return `${provider}:${connectorInstanceId}`;
}

function createGoogleAdapter(
  provider: GoogleProvider,
  manifest: AppMcpProviderManifest,
): AppConnectorProviderAdapter {
  return {
    appId: 'sentropic',
    connectorId: manifest.providerId,
    manifest,

    async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
      // Narrow-only: retain core-authorized identities and never widen selector hints.
      return {
        principalRef: input.principalSub,
        tenantRef: input.tenantRef,
        workspaceRef: input.workspaceRef,
        connectorInstanceId: input.connectorInstanceId,
      };
    },

    async listCapabilities(_ctx: ConnectorTenantContext): Promise<AppCapability[]> {
      return [...manifest.resources, ...manifest.tools, ...manifest.prompts];
    },

    async readResource(req: AppResourceRead): Promise<AppResourceResult> {
      const auditId = nextAuditId(provider, 'resource');
      // This is the per-account secret-by-reference seam. The fixture adapter
      // intentionally makes no egress and never logs, emits, or returns the value.
      await req.ctx.getSecret('googleOAuthAccessToken');
      await req.ctx.audit.emit({ domain: provider, capabilityRef: req.capabilityRef, uri: req.input.uri });

      const fixture = getResourceFixture(provider, req.capabilityRef);
      if (fixture === undefined) {
        return unknownCapabilityResult('resource', req.capabilityRef, auditId, 'low');
      }
      return {
        ok: true,
        output: fixture,
        auditId,
        redactionClass: capabilityRedactionClass(manifest, 'resource', req.capabilityRef),
      };
    },

    async invokeTool(req: AppToolInvocation): Promise<AppToolResult | DurableCallRef> {
      const auditId = nextAuditId(provider, 'tool');
      // Invoked even for fixtures so the host proves account-scoped reference resolution.
      await req.ctx.getSecret('googleOAuthAccessToken');
      await req.ctx.audit.emit({ domain: provider, capabilityRef: req.capabilityRef });

      const fixture = getToolFixture(provider, req.capabilityRef);
      if (fixture === undefined) {
        return unknownCapabilityResult('tool', req.capabilityRef, auditId, 'low');
      }
      return {
        ok: true,
        output: fixture,
        auditId,
        redactionClass: capabilityRedactionClass(manifest, 'tool', req.capabilityRef),
      };
    },

    async validateSecrets(_ctx: ConnectorTenantContext): Promise<ConnectorSecretStatus> {
      // State only: this contract does not expose a raw secret value.
      return [{ name: 'googleOAuthAccessToken', scope: 'principal', state: 'active' }];
    },
  };
}

function capabilityRedactionClass(
  manifest: AppMcpProviderManifest,
  kind: 'resource' | 'tool',
  capabilityRef: string,
): RedactionClass {
  const capabilities = kind === 'resource' ? manifest.resources : manifest.tools;
  return capabilities.find((capability) => capability.name === capabilityRef)?.redactionClass ?? 'low';
}

function unknownCapabilityResult(
  kind: 'resource' | 'tool',
  capabilityRef: string,
  auditId: string,
  redactionClass: 'low',
): AppToolResult {
  return {
    ok: false,
    auditId,
    redactionClass,
    error: {
      code: `unknown_${kind}`,
      message: `No synthetic fixture registered for ${kind} "${capabilityRef}".`,
      retriable: false,
    },
  };
}

export const googleDriveAdapter = createGoogleAdapter('googleDrive', googleDriveManifest);
export const gmailAdapter = createGoogleAdapter('gmail', gmailManifest);
