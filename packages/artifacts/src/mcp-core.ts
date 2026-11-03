/** Platform-free provider composition over the shared typed HTTP application. */
import type { AppConnectorProviderAdapter, AppMcpProviderManifest, AppToolInvocation,
  AppToolResult, CapabilityTool } from '@sentropic/mcp-platform';
import type { ProviderParameterSchema } from '@sentropic/mcp-platform/registry';
import type { ArtifactApp, HttpRequest, HttpResponse } from './http.js';
import { assertArtifactsTransportProfile } from './http.js';
import { ARTIFACT_CAPABILITY_NAMES, ArtifactProfileInputError,
  type CompiledArtifactsProfile } from './profile/index.js';
import type { ArtifactInvocationContext } from './server/commit/types.js';
import { ArtifactOperationError, classifyArtifactFailure, type ArtifactOutcome, type ArtifactHostFailureMapper } from './server/failures.js';
import { projectArtifactHttpOutcome, projectArtifactMcpOutcome } from './server/outcome-projection.js';
export * from './profile/index.js';
export { createRadarKeyDerivation } from './server/command-identity.js';
export type { ArtifactKeyDerivationBinding } from './server/command-identity.js';

export const ARTIFACTS_PROVIDER_ID = 'sentropic.artifacts';
export const ARTIFACTS_APP_ID = 'sentropic-artifacts';
export const ARTIFACTS_PROVIDER_VERSION = '0.2.8';
export const ARTIFACTS_TOOL_NAMES = ARTIFACT_CAPABILITY_NAMES;
export type ArtifactsToolName = (typeof ARTIFACTS_TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// Byte-stable tool definitions (MCP tool-definition stability rule).
//
// MCP hosts such as claude.ai reset per-tool "Always allow" permissions
// whenever a tool definition (description, inputSchema, outputSchema,
// annotations, _meta) changes between sessions. Every value below is a
// compile-time constant: no profile revision, provider version, digest,
// limit, default or date may appear in a definition. The active profile
// still constrains invocations server-side (profile.validate) and stays
// visible in manifest audit metadata and typed result details — never in a
// tool definition. The APP-P1 manifest pin keeps covering these
// definitions, so the pin is stable across profile switches as well.
// ---------------------------------------------------------------------------

const str = { type: 'string', minLength: 1 } as const;
const integer = (minimum: number, maximum?: number) => ({ type: 'integer', minimum,
  ...(maximum === undefined ? {} : { maximum }) });
const obj = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const id = { type: 'string',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } as const;
const idempotencyKey = { type: 'string', minLength: 1, description:
  'Nonblank by JavaScript trim(); the active profile bounds its length in UTF-16 units; original bytes retained.' } as const;
const expectedCurrentReleaseId = { ...id, type: ['string', 'null'], description:
  'Compare the current release atomically; null requires an unpublished artifact.' } as const;
const primitiveRecord = { type: 'object',
  additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } } as const;
const metadata = {
  title: { type: 'string', minLength: 1, maxLength: 160, description: 'Artifact display title.' },
  description: { type: 'string', maxLength: 2000, description: 'Short artifact description.' },
  icon: { type: ['string', 'null'], pattern: '^[a-z][a-z0-9-]{0,31}$',
    description: 'One short lowercase word.' },
} as const;
const path = { type: 'string', minLength: 1, description:
  'Manifest path; the active profile bounds its byte length and forbids reserved or dot segments, enforced server-side with typed errors.' } as const;
const file = obj({ path, mimeType: str, text: { type: 'string' },
  bytes: { type: 'array', items: integer(0, 255) } }, ['path', 'mimeType']);
const edit = obj({ path, oldStr: str, newStr: { type: 'string' } }, ['path', 'oldStr', 'newStr']);
const idOnly = obj({ artifactId: id }, ['artifactId']);

const ARTIFACTS_OUTPUT_SCHEMA = { type: 'object', additionalProperties: true } as const;

const READ_ONLY_TOOLS: readonly ArtifactsToolName[] = ['artifacts_list', 'artifacts_get',
  'artifacts_get_template', 'artifacts_get_api_guide', 'artifacts_get_source', 'artifacts_list_versions'];
const IDEMPOTENT_WRITERS: readonly ArtifactsToolName[] = ['artifacts_ensure', 'artifacts_publish',
  'artifacts_commit_upload', 'artifacts_set_access', 'artifacts_delete', 'artifacts_revert'];

export interface ArtifactsToolDefinition {
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly mutability: CapabilityTool['mutability'];
  readonly idempotency: CapabilityTool['idempotency'];
  readonly gates: CapabilityTool['gates'];
}

function staticTool(name: ArtifactsToolName, inputSchema: Record<string, unknown>,
  description?: string): ArtifactsToolDefinition {
  return {
    description: description ?? `Artifacts ${name.slice('artifacts_'.length).replaceAll('_', ' ')}.`,
    inputSchema,
    outputSchema: ARTIFACTS_OUTPUT_SCHEMA,
    mutability: READ_ONLY_TOOLS.includes(name) ? 'read-only'
      : name === 'artifacts_publish' ? 'append' : 'state-transition',
    idempotency: IDEMPOTENT_WRITERS.includes(name) ? { required: true, scope: 'principal' } : { required: false },
    gates: { requiresElicitation: false, requiresHumanConfirmation: name === 'artifacts_delete',
      requiresPrincipalGate: false },
  };
}

/** Static wire definitions for every artifacts tool; identical across deployments and profiles. */
export const ARTIFACTS_TOOL_DEFINITIONS: Readonly<Record<ArtifactsToolName, ArtifactsToolDefinition>> = {
  artifacts_get_template: staticTool('artifacts_get_template', obj({ templateId: str }, ['templateId'])),
  artifacts_get_api_guide: staticTool('artifacts_get_api_guide', obj({ version: str })),
  artifacts_ensure: staticTool('artifacts_ensure', obj({ bindingName: str, parameters: obj({}),
    idempotencyKey, ...metadata }, ['bindingName', 'idempotencyKey'])),
  artifacts_publish: staticTool('artifacts_publish', obj({ artifactId: id, idempotencyKey,
    files: { type: 'array', items: file, minItems: 1,
      description: 'Full file set; required unless edits is supplied.' },
    edits: { type: 'array', items: edit, minItems: 1, maxItems: 100,
      description: 'Small old/new edits applied to the current release text files; required unless files is supplied.' },
    expectedCurrentReleaseId, profile: primitiveRecord, ...metadata }, ['artifactId', 'idempotencyKey'])),
  artifacts_create_upload: staticTool('artifacts_create_upload', obj({ artifactId: id, mimeType: str,
    maxSize: integer(1) }, ['artifactId', 'mimeType'])),
  artifacts_commit_upload: staticTool('artifacts_commit_upload', obj({ artifactId: id, uploadId: str,
    path, mimeType: str, digest: str, size: integer(0), profile: primitiveRecord, idempotencyKey },
    ['artifactId', 'uploadId', 'path', 'mimeType', 'digest', 'size', 'idempotencyKey'])),
  artifacts_list: staticTool('artifacts_list', obj({ limit: integer(1), offset: integer(0) })),
  artifacts_get: staticTool('artifacts_get', idOnly),
  artifacts_get_source: staticTool('artifacts_get_source', obj({ artifactId: id, releaseId: id,
    paths: { type: 'array', minItems: 1, maxItems: 32, items: str } }, ['artifactId']),
    'Artifacts get source: verified files of the current or a selected release as `text` (encoding "utf8") '
      + 'or `base64` (encoding "base64"), never an integer array, plus a guideRef instead of the guide body.'),
  artifacts_fork: staticTool('artifacts_fork', idOnly),
  artifacts_set_access: staticTool('artifacts_set_access', obj({ artifactId: id,
    action: { type: 'string', enum: ['grant', 'revoke'] }, principalId: { ...str, maxLength: 256 },
    grant: { type: 'string', enum: ['read'] }, idempotencyKey },
    ['artifactId', 'action', 'principalId', 'idempotencyKey'])),
  artifacts_promote: staticTool('artifacts_promote', obj({ artifactId: id, releaseId: id, expectedCurrent: id },
    ['artifactId', 'releaseId', 'expectedCurrent'])),
  artifacts_renew: staticTool('artifacts_renew', idOnly),
  artifacts_delete: staticTool('artifacts_delete', obj({ artifactId: id, expectedCurrentReleaseId,
    idempotencyKey, confirmationRef: { ...str, maxLength: 4096 } }, ['artifactId', 'idempotencyKey'])),
  artifacts_restore: staticTool('artifacts_restore', idOnly),
  artifacts_list_versions: staticTool('artifacts_list_versions', obj({ artifactId: id,
    limit: integer(1, 100), cursor: { ...str, maxLength: 4096 } }, ['artifactId'])),
  artifacts_revert: staticTool('artifacts_revert', obj({ artifactId: id, releaseId: id, targetReleaseId: id,
    expectedCurrentReleaseId, idempotencyKey }, ['artifactId', 'idempotencyKey'])),
};

export const ARTIFACTS_TOOL_SPECS = ARTIFACTS_TOOL_NAMES.map((name) => ({ name,
  description: ARTIFACTS_TOOL_DEFINITIONS[name].description,
  mutability: ARTIFACTS_TOOL_DEFINITIONS[name].mutability }));
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
    // Tool definitions come only from ARTIFACTS_TOOL_DEFINITIONS: the profile selects
    // which tools exist, but never what a definition says.
    tools: ARTIFACTS_TOOL_NAMES.filter((name) => profile.selectedCapabilities.includes(name)).map((name) => {
      const definition = ARTIFACTS_TOOL_DEFINITIONS[name];
      return {
        kind: 'tool', name,
        description: definition.description,
        inputSchema: definition.inputSchema, outputSchema: definition.outputSchema,
        requiredScopes: [...scopes], requiredClaims: [], redactionClass: 'low',
        mutability: definition.mutability, mutatesExternalSystem: definition.mutability !== 'read-only',
        idempotency: definition.idempotency,
        gates: definition.gates,
      };
    }),
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
function rejected(cause: unknown, invocationId: string, operation: string,
  mapHostError?: ArtifactHostFailureMapper): ArtifactOutcome<HttpResponse> {
  return { ok: false, failure: classifyArtifactFailure(cause, { invocationId, operation,
    phase: cause instanceof ArtifactProfileInputError ? cause.phase : 'entry', commitState: 'not_committed' },
  (error) => error instanceof ArtifactProfileInputError
    ? new ArtifactOperationError(error.category, { publicDetails: error.details }) : mapHostError?.(error)) };
}

export function createArtifactsToolExecutor(deps: { app: ArtifactsApp; profile: CompiledArtifactsProfile;
  mapHostError?: ArtifactHostFailureMapper }) {
  assertArtifactsTransportProfile(deps.profile);
  const profile = deps.profile;
  if (deps.app.profileDigest !== profile.profileDigest ||
    JSON.stringify(deps.app.selectedCapabilities) !== JSON.stringify(profile.selectedCapabilities)) {
    throw new Error('artifacts app/profile mismatch');
  }
  async function execute(input: ArtifactsInvokeInput): Promise<ArtifactOutcome<HttpResponse>> {
    try {
      const args = profile.validate(input.tool, input.args, input.idempotencyKey, { deferPrecondition: true });
      let request: Pick<HttpRequest, 'method' | 'path' | 'body'>;
      switch (input.tool) {
        case 'artifacts_ensure': request = { method: 'POST', path: '/ensure', body: args }; break;
        case 'artifacts_publish': request = { method: 'POST', path: '/publish', body: args }; break;
        case 'artifacts_list': request = { method: 'POST', path: '/list', body: args }; break;
        case 'artifacts_get': request = { method: 'GET', path: `/meta/${args.artifactId}`, body: undefined }; break;
        case 'artifacts_get_source': request = { method: 'POST', path: '/get_source', body: args }; break;
        case 'artifacts_set_access': request = { method: 'POST', path: '/set_access', body: args }; break;
        case 'artifacts_delete': request = { method: 'POST', path: '/delete', body: args }; break;
        case 'artifacts_list_versions': request = { method: 'POST', path: '/list_versions', body: args }; break;
        case 'artifacts_revert': request = { method: 'POST', path: '/revert', body: args }; break;
        default: throw new ArtifactProfileInputError(true);
      }
      return await deps.app.execute({ ...request, actorId: input.invocation.actorId,
        storageScopeId: input.invocation.storageScopeId, idempotencyKey: input.idempotencyKey }, input.invocation);
    } catch (cause) { return rejected(cause, input.invocation?.invocationId ?? '', input.tool, deps.mapHostError); }
  }
  return { execute, async invoke(input: ArtifactsInvokeInput): Promise<HttpResponse> {
    return projectArtifactHttpOutcome(await execute(input), profile.resultEnvelopeVersion === 2);
  } };
}

export interface ArtifactsAdapterOptions extends ArtifactsManifestOptions {
  /** Trusted mapping for failures in the MCP host binding. */
  mapHostError?: ArtifactHostFailureMapper;
  app: ArtifactsApp;
  /** Bind verified principal/scope and request authorization in trusted host code. */
  createInvocation(request: AppToolInvocation): ArtifactInvocationContext | Promise<ArtifactInvocationContext>;
}
export function createArtifactsAdapter(options: ArtifactsAdapterOptions): AppConnectorProviderAdapter {
  const manifest = createArtifactsManifest(options);
  if (typeof options.createInvocation !== 'function') throw new Error('artifacts requires a trusted invocation factory');
  const executor = createArtifactsToolExecutor(options);
  return {
    appId: ARTIFACTS_APP_ID, connectorId: ARTIFACTS_PROVIDER_ID, manifest,
    resolveTenant: async (input) => ({ principalRef: input.principalSub, tenantRef: input.tenantRef,
      connectorInstanceId: input.connectorInstanceId,
      ...(input.workspaceRef === undefined ? {} : { workspaceRef: input.workspaceRef }) }),
    listCapabilities: async () => [...manifest.tools],
    async invokeTool(request): Promise<AppToolResult> {
      let outcome: ArtifactOutcome<HttpResponse>;
      try {
        // Selection and closed input checks precede even the host invocation binding.
        options.profile.validate(request.capabilityRef, request.input, request.idempotencyKey, { deferPrecondition: true });
        const invocation = await options.createInvocation(request);
        if (invocation.actorId !== request.ctx.principal.sub) throw new ArtifactProfileInputError();
        outcome = await executor.execute({ tool: request.capabilityRef, args: request.input,
          invocation, idempotencyKey: request.idempotencyKey });
      } catch (cause) { outcome = rejected(cause, request.ctx.requestId, request.capabilityRef, options.mapHostError); }
      return projectArtifactMcpOutcome(outcome, request.ctx.auditId, options.profile.resultEnvelopeVersion ?? 1);
    },
    readResource: async (request) => ({ ok: false, auditId: request.ctx.auditId, redactionClass: 'low',
      error: { code: 'not_found', message: 'not_found', retriable: false } }),
    validateSecrets: async () => [],
  };
}
