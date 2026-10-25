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

): AppMcpProviderManifest {
  const scopes = options.invocationScope === undefined ? [] : [options.invocationScope];
  const tools: CapabilityTool[] = ARTIFACTS_TOOL_SPECS.map((spec) => ({
    kind: 'tool',
    name: spec.name,
    description: spec.description,
    requiredScopes: [...scopes],
    requiredClaims: [],
    inputSchema: spec.inputSchema,
    outputSchema: { type: 'object' },
    redactionClass: 'low',
    mutability: spec.mutability,
    mutatesExternalSystem: spec.mutability !== 'read-only',
    idempotency: spec.idempotent === true
      ? { required: true, scope: 'principal' }
      : { required: false },
    gates: {
      requiresElicitation: false,
      requiresHumanConfirmation: spec.confirm === true,
      requiresPrincipalGate: false,
    },
  }));
  return {
    appId: ARTIFACTS_APP_ID,
    providerId: ARTIFACTS_PROVIDER_ID,
    version: ARTIFACTS_PROVIDER_VERSION,
    displayName: options.displayName ?? 'Sentropic Artifacts',
    resources: [],
    tools,
    prompts: [],
    authz: { requiredClaims: [], scopes: [...scopes], tenantResolution: 'custom-resolver' },
    audit: { eventKinds: ['invoke'] },
    durability: {},
  };
}

// ---------------------------------------------------------------------------
// Part 2 — tool executor over the shared HTTP app (HTTP/MCP parity by
// construction: one application layer, one authorization order, stable
// error codes). Unknown tools and malformed arguments throw before any
// app call, so a refused invocation has no effects.
// ---------------------------------------------------------------------------

export interface ArtifactsApp {
  handle(request: HttpRequest): Promise<HttpResponse>;
}

export interface ArtifactsInvokeInput {
  tool: string;
  actorId: string;
  /** Trusted host scope; tool arguments cannot select storage. */
  storageScopeId?: string;
  args: Record<string, unknown>;
}

function needString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid request: missing ${name}`);
  }
  return value;
}

function optString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.length !== 0 ? value : undefined;
}

/** Create the 15-tool executor over any conforming artifacts HTTP app. */
export function createArtifactsToolExecutor(deps: {
  app: ArtifactsApp;
  defaultStorageScopeId?: string;
}) {
  const call = (
    actorId: string,
    method: string,
    path: string,
    body?: unknown,
    storageScopeId?: string,
  ): Promise<HttpResponse> => deps.app.handle({
    method, path, actorId, body, storageScopeId: storageScopeId ?? deps.defaultStorageScopeId,
  });

  function setAccess(actorId: string, args: Record<string, unknown>): Promise<HttpResponse> {
    const artifactId = needString(args, 'artifactId');
    const action = needString(args, 'action');
    if (action === 'grant') {
      const grant = needString(args, 'grant');
      if (grant !== 'read' && grant !== 'source') {
        throw new Error('invalid request: grant must be read or source');
      }
      return call(actorId, 'POST', '/access/grant', {
        artifactId, principalId: needString(args, 'principalId'), grant,
      });
    }
    if (action === 'revoke') {
      return call(actorId, 'POST', '/access/revoke', {
        artifactId, principalId: needString(args, 'principalId'),
      });
    }
    if (action === 'set-public') {
      if (typeof args['isPublic'] !== 'boolean') {
        throw new Error('invalid request: isPublic must be a boolean');
      }
      return call(actorId, 'POST', '/access/public', { artifactId, isPublic: args['isPublic'] });
    }
    throw new Error(`invalid request: unknown set-access action ${action}`);
  }

  return {
    async invoke(input: ArtifactsInvokeInput): Promise<HttpResponse> {
      const { actorId, args } = input;
      switch (input.tool) {
        case 'artifacts_get_template':
          return call(actorId, 'GET', `/templates/${needString(args, 'templateId')}`);
        case 'artifacts_get_api_guide': {
          const version = optString(args, 'version');
          return call(actorId, 'GET', version === undefined ? '/api-guide' : `/api-guide/${version}`);
        }
        case 'artifacts_ensure':
          return call(actorId, 'POST', '/ensure', {
            bindingName: needString(args, 'bindingName'),
            idempotencyKey: needString(args, 'idempotencyKey'),
            paramsHash: optString(args, 'paramsHash') ?? '',
            parameters: args['parameters'] ?? {},
          }, input.storageScopeId);
        case 'artifacts_publish':
          return call(actorId, 'POST', '/publish', {
            artifactId: needString(args, 'artifactId'),
            files: args['files'],
            profile: args['profile'] ?? {},
            source: args['source'],
            idempotencyKey: optString(args, 'idempotencyKey'),
            paramsHash: optString(args, 'paramsHash'),
          });
        case 'artifacts_create_upload':
          return call(actorId, 'POST', '/uploads', {
            artifactId: needString(args, 'artifactId'),
            mimeType: needString(args, 'mimeType'),
            maxSize: args['maxSize'],
          });
        case 'artifacts_commit_upload':
          return call(actorId, 'POST', '/uploads/commit', {
            artifactId: needString(args, 'artifactId'),
            uploadId: needString(args, 'uploadId'),
            path: needString(args, 'path'),
            mimeType: needString(args, 'mimeType'),
            digest: needString(args, 'digest'),
            size: args['size'],
            profile: args['profile'] ?? {},
            idempotencyKey: optString(args, 'idempotencyKey'),
            paramsHash: optString(args, 'paramsHash'),
          });
        case 'artifacts_list':
          return call(actorId, 'POST', '/list', { limit: args['limit'], offset: args['offset'] });
        case 'artifacts_get':
          return call(actorId, 'GET', `/meta/${needString(args, 'artifactId')}`);
        case 'artifacts_get_source':
          return call(actorId, 'GET', `/source/${needString(args, 'artifactId')}`);
        case 'artifacts_fork':
          return call(actorId, 'POST', '/fork', { artifactId: needString(args, 'artifactId') });
        case 'artifacts_set_access':
          return setAccess(actorId, args);
        case 'artifacts_promote':
          return call(actorId, 'POST', '/promote', {
            artifactId: needString(args, 'artifactId'),
            releaseId: needString(args, 'releaseId'),
            expectedCurrent: needString(args, 'expectedCurrent'),
          });
        case 'artifacts_renew':
          return call(actorId, 'POST', '/renew', { artifactId: needString(args, 'artifactId') });
        case 'artifacts_delete':
          return call(actorId, 'POST', '/delete', { artifactId: needString(args, 'artifactId') });
        case 'artifacts_restore':
          return call(actorId, 'POST', '/restore', { artifactId: needString(args, 'artifactId') });
        default:
          throw new Error(`unknown artifacts tool: ${input.tool}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Part 3 — platform adapter + kernel registry definition (§3). Identity
// comes from the verified connector context (principal.sub), never from
// tool arguments. Errors surface as stable codes only; executor throws
// (unknown tool, malformed arguments) become invalid_request with no raw
// message leakage. Registration goes through the one mcp-platform kernel;
// no connector-host registry is added.
// ---------------------------------------------------------------------------

export interface ArtifactsAdapterOptions extends ArtifactsManifestOptions {
  app: ArtifactsApp;
  defaultStorageScopeId?: string;
}

function errorCodeOf(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const code = (body as Record<string, unknown>)['error'];
    if (typeof code === 'string' && code.length !== 0) return code;
  }
  return 'internal_error';
}

/** Create the platform adapter driving the 15 tools over the shared app. */
export function createArtifactsAdapter(
  options: ArtifactsAdapterOptions,
): AppConnectorProviderAdapter {
  const manifest = createArtifactsManifest(options);
  const executor = createArtifactsToolExecutor({
    app: options.app,
    defaultStorageScopeId: options.defaultStorageScopeId,
  });
  return {
    appId: ARTIFACTS_APP_ID,
    connectorId: ARTIFACTS_PROVIDER_ID,
    manifest,
    resolveTenant: (input) => Promise.resolve({
      principalRef: input.principalSub,
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
