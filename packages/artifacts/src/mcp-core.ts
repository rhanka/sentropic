/** Platform-free provider composition over the shared typed HTTP application. */
import type { AppConnectorProviderAdapter, AppMcpProviderManifest, AppToolInvocation,
  AppToolResult, CapabilityTool } from '@sentropic/mcp-platform';
import type { ProviderParameterSchema } from '@sentropic/mcp-platform/registry';
import type { ArtifactApp, HttpRequest, HttpResponse } from './http.js';
import { assertArtifactsTransportProfile } from './http.js';
import { ARTIFACT_CAPABILITY_NAMES, ArtifactProfileInputError,
  type CompiledArtifactsProfile } from './profile/index.js';
import type { ArtifactInvocationContext } from './server/commit/types.js';
import { ArtifactOperationError, classifyArtifactFailure, type ArtifactOutcome } from './server/failures.js';
import { projectArtifactHttpOutcome, projectArtifactMcpOutcome } from './server/outcome-projection.js';
export * from './profile/index.js';
export { createRadarKeyDerivation } from './server/command-identity.js';
export type { ArtifactKeyDerivationBinding } from './server/command-identity.js';

export const ARTIFACTS_PROVIDER_ID = 'sentropic.artifacts';
export const ARTIFACTS_APP_ID = 'sentropic-artifacts';
export const ARTIFACTS_PROVIDER_VERSION = '0.2.0';
export const ARTIFACTS_TOOL_NAMES = ARTIFACT_CAPABILITY_NAMES;
export type ArtifactsToolName = (typeof ARTIFACTS_TOOL_NAMES)[number];

export const ARTIFACTS_TOOL_SPECS = ARTIFACTS_TOOL_NAMES.map((name) => ({ name,
  description: `Artifacts ${name.slice('artifacts_'.length).replaceAll('_', ' ')}.`,
  mutability: (['artifacts_list', 'artifacts_get', 'artifacts_get_template', 'artifacts_get_api_guide',
    'artifacts_get_source'].includes(name) ? 'read-only' : name === 'artifacts_publish' ? 'append' : 'state-transition') as CapabilityTool['mutability'],
}));
export const ARTIFACTS_PARAMETER_SCHEMA: ProviderParameterSchema = { properties: {}, required: [] };
export interface ArtifactsManifestOptions {
  profile: CompiledArtifactsProfile;
  invocationScope?: string;
  displayName?: string;
}
export type ArtifactsManifest = AppMcpProviderManifest & {
  audit: AppMcpProviderManifest['audit'] & { artifactsProfileDigest: string };
};

export function createArtifactsManifest(options: ArtifactsManifestOptions): ArtifactsManifest {
  assertArtifactsTransportProfile(options?.profile);
  const { profile } = options;
  const scopes = options.invocationScope === undefined ? [] : [options.invocationScope];
  return {
    appId: ARTIFACTS_APP_ID, providerId: ARTIFACTS_PROVIDER_ID, version: ARTIFACTS_PROVIDER_VERSION,
    displayName: options.displayName ?? 'Sentropic Artifacts',
    resources: [], prompts: [],
    tools: ARTIFACTS_TOOL_SPECS.filter((spec) => profile.selectedCapabilities.includes(spec.name)).map((spec) => ({
      kind: 'tool', name: spec.name,
      description: spec.description,
      inputSchema: profile.schemas[spec.name]!, outputSchema: { type: 'object' },
      requiredScopes: [...scopes], requiredClaims: [], redactionClass: 'low',
      mutability: spec.mutability, mutatesExternalSystem: spec.mutability !== 'read-only',
      idempotency: profile.idempotency[spec.name] ?? { required: false },
      gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
    })),
    authz: { requiredClaims: [], scopes, tenantResolution: 'custom-resolver' },
    // The existing manifest codec includes audit metadata, including for an empty tool set.
    audit: { eventKinds: ['invoke'], artifactsProfileDigest: profile.profileDigest }, durability: {},
  };
}

export type ArtifactsApp = Pick<ArtifactApp, 'execute' | 'selectedCapabilities' | 'profileDigest'>;
export interface ArtifactsInvokeInput {
  tool: string;
  invocation: ArtifactInvocationContext;
  args: unknown;
  idempotencyKey?: string;
}
function rejected(cause: unknown, invocationId: string, operation: string): ArtifactOutcome<HttpResponse> {
  return { ok: false, failure: classifyArtifactFailure(cause, { invocationId, operation,
    phase: cause instanceof ArtifactProfileInputError ? cause.phase : 'entry', commitState: 'not_committed' },
  (error) => error instanceof ArtifactProfileInputError ? new ArtifactOperationError(error.category) : undefined) };
}

export function createArtifactsToolExecutor(deps: { app: ArtifactsApp; profile: CompiledArtifactsProfile }) {
  assertArtifactsTransportProfile(deps.profile);
  const profile = deps.profile;
  if (deps.app.profileDigest !== profile.profileDigest ||
    JSON.stringify(deps.app.selectedCapabilities) !== JSON.stringify(profile.selectedCapabilities)) {
    throw new Error('artifacts app/profile mismatch');
  }
  async function execute(input: ArtifactsInvokeInput): Promise<ArtifactOutcome<HttpResponse>> {
    try {
      const args = profile.validate(input.tool, input.args, input.idempotencyKey);
      let request: Pick<HttpRequest, 'method' | 'path' | 'body'>;
      switch (input.tool) {
        case 'artifacts_ensure': request = { method: 'POST', path: '/ensure', body: args }; break;
        case 'artifacts_publish': request = { method: 'POST', path: '/publish', body: args }; break;
        case 'artifacts_list': request = { method: 'POST', path: '/list', body: args }; break;
        case 'artifacts_get': request = { method: 'GET', path: `/meta/${args.artifactId}`, body: undefined }; break;
        default: throw new ArtifactProfileInputError(true);
      }
      return await deps.app.execute({ ...request, actorId: input.invocation.actorId,
        storageScopeId: input.invocation.storageScopeId, idempotencyKey: input.idempotencyKey }, input.invocation);
    } catch (cause) { return rejected(cause, input.invocation?.invocationId ?? '', input.tool); }
  }
  return { execute, async invoke(input: ArtifactsInvokeInput): Promise<HttpResponse> {
    return projectArtifactHttpOutcome(await execute(input));
  } };
}

export interface ArtifactsAdapterOptions extends ArtifactsManifestOptions {
  app: ArtifactsApp;
  /** Bind verified principal/scope and request authorization in trusted host code. */
  createInvocation(request: AppToolInvocation): ArtifactInvocationContext | Promise<ArtifactInvocationContext>;
}
export function createArtifactsAdapter(options: ArtifactsAdapterOptions): AppConnectorProviderAdapter {
  const manifest = createArtifactsManifest(options);
  if (typeof options.createInvocation !== 'function') throw new Error('artifacts requires a trusted invocation factory');
  const executor = createArtifactsToolExecutor(options);
  return {
      tenantRef: input.tenantRef,
      connectorInstanceId: input.connectorInstanceId,
      ...(input.workspaceRef === undefined ? {} : { workspaceRef: input.workspaceRef }),
    }),
    listCapabilities: () => Promise.resolve([...manifest.tools]),
    async invokeTool(req): Promise<AppToolResult> {
      const auditId = req.ctx.auditId;
      try {
        const args = typeof req.input === 'object' && req.input !== null && !Array.isArray(req.input)
          ? (req.input as Record<string, unknown>)
          : {};
        if (manifest.tools.some((tool) => tool.name === req.capabilityRef && tool.idempotency.required)) {
          const key = needString(args, 'idempotencyKey');
          if (req.idempotencyKey !== undefined && req.idempotencyKey !== key) {
            throw new Error('invalid request: conflicting idempotency key');
          }
        }
        const res = await executor.invoke({
          tool: req.capabilityRef,
          actorId: req.ctx.principal.sub,
          args,
        });
        if (res.status >= 200 && res.status < 300) {
          return { ok: true, output: res.body, auditId, redactionClass: 'low' };
        }
        const code = errorCodeOf(res.body);
        return {
          ok: false, auditId, redactionClass: 'low',
          error: { code, message: code, retriable: res.status >= 500 },
        };
      } catch {
        return {
          ok: false, auditId, redactionClass: 'low',
          error: { code: 'invalid_request', message: 'invalid_request', retriable: false },
        };
      }
    },
    readResource: (req) => Promise.resolve({
      ok: false,
      auditId: req.ctx.auditId,
      redactionClass: 'low',
      error: { code: 'not_found', message: 'not_found', retriable: false },
    }),
    validateSecrets: () => Promise.resolve([]),
  };
}
