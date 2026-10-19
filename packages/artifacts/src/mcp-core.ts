/**
 * L-5e — reusable artifacts MCP provider (spec-v8 §9 5e, review B3).
 *
 * Part 1: identity, the 15 exact `artifacts_*` tool specs with closed input
 * schemas, and the platform manifest. The logical provider ID is
 * `sentropic.artifacts`; the generic provider hardcodes no application
 * OAuth vocabulary — a host binds its invocation scope through the
 * manifest factory before digests freeze (§3.5). Part 2 adds the tool
 * executor over the same HTTP app direct calls use; part 3 adds the
 * platform adapter and the kernel registry definition (§3).
 */
import type {
  AppConnectorProviderAdapter,
  AppMcpProviderManifest,
  AppToolResult,
  CapabilityTool,
} from '@sentropic/mcp-platform';
import type { ProviderParameterSchema } from '@sentropic/mcp-platform/registry';
import type { HttpRequest, HttpResponse } from './http.js';
import { TEXT_MIME_PATTERN } from './http.js';

export const ARTIFACTS_PROVIDER_ID = 'sentropic.artifacts';
export const ARTIFACTS_APP_ID = 'sentropic-artifacts';
export const ARTIFACTS_PROVIDER_VERSION = '0.1.4';

export const ARTIFACTS_TOOL_NAMES = [
  'artifacts_get_template', 'artifacts_get_api_guide', 'artifacts_ensure',
  'artifacts_publish', 'artifacts_create_upload', 'artifacts_commit_upload',
  'artifacts_list', 'artifacts_get', 'artifacts_get_source', 'artifacts_fork',
  'artifacts_set_access', 'artifacts_promote', 'artifacts_renew',
  'artifacts_delete', 'artifacts_restore',
] as const;

export type ArtifactsToolName = (typeof ARTIFACTS_TOOL_NAMES)[number];

type Schema = Record<string, unknown>;
const str: Schema = { type: 'string', minLength: 1 };
const int = (minimum: number, maximum?: number): Schema => ({
  type: 'integer', minimum, ...(maximum === undefined ? {} : { maximum }),
});
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object', properties, required, additionalProperties: false,
});
const record: Schema = {
  type: 'object',
  additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
};
const fileBytes: Schema = { type: 'array', items: int(0, 255) };
const fileEntry: Schema = {
  ...obj({ path: str, mimeType: str, bytes: fileBytes, text: { type: 'string', description: 'UTF-8 text; mutually exclusive with bytes; text MIME types only.' } }, ['path', 'mimeType']),
  oneOf: [
    { required: ['bytes'], not: { required: ['text'] } },
    { required: ['text'], not: { required: ['bytes'] }, properties: { mimeType: { pattern: TEXT_MIME_PATTERN } } },
  ],
};
const sourceRef = obj(
  {
    kind: { type: 'string', enum: ['inline-original', 'base-commit', 'recipe'] },
    commit: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
  },
  ['kind'],
);

interface ToolSpec {
  name: ArtifactsToolName;
  description: string;
  inputSchema: Schema;
  mutability: CapabilityTool['mutability'];
  idempotent?: boolean;
  confirm?: boolean;
}

const idOnly = obj({ artifactId: str }, ['artifactId']);

export const ARTIFACTS_TOOL_SPECS: readonly ToolSpec[] = [
  { name: 'artifacts_get_template', description: 'Get an approved template kit (sources + build recipe).', inputSchema: obj({ templateId: str }, ['templateId']), mutability: 'read-only' },
  { name: 'artifacts_get_api_guide', description: 'Get the versioned artifacts API guide.', inputSchema: obj({ version: str }), mutability: 'read-only' },
  { name: 'artifacts_ensure', description: 'Resolve or create the private artifact view for a binding.', inputSchema: obj({ bindingName: str, storageScopeId: str, idempotencyKey: str, paramsHash: str, parameters: record }, ['bindingName', 'idempotencyKey']), mutability: 'state-transition', idempotent: true },
  { name: 'artifacts_publish', description: 'Publish inline files as a new release.', inputSchema: obj({ artifactId: str, files: { type: 'array', minItems: 1, items: fileEntry }, profile: record, source: sourceRef, idempotencyKey: str, paramsHash: str }, ['artifactId', 'files']), mutability: 'append', idempotent: true },
  { name: 'artifacts_create_upload', description: 'Open a bounded upload session for large bytes.', inputSchema: obj({ artifactId: str, mimeType: str, maxSize: int(1) }, ['artifactId', 'mimeType']), mutability: 'state-transition' },
  { name: 'artifacts_commit_upload', description: 'Verify staged bytes and publish them as a release.', inputSchema: obj({ artifactId: str, uploadId: str, path: str, mimeType: str, digest: str, size: int(0), profile: record, idempotencyKey: str, paramsHash: str }, ['artifactId', 'uploadId', 'path', 'mimeType', 'digest', 'size']), mutability: 'append', idempotent: true },
  { name: 'artifacts_list', description: 'List artifacts visible to the caller (ACL before pagination).', inputSchema: obj({ limit: int(1, 100), offset: int(0) }), mutability: 'read-only' },
  { name: 'artifacts_get', description: 'Get artifact metadata (grants visible to the owner only).', inputSchema: idOnly, mutability: 'read-only' },
  { name: 'artifacts_get_source', description: 'Export the attached source reference (separate right).', inputSchema: idOnly, mutability: 'read-only' },
  { name: 'artifacts_fork', description: 'Fork privately under a fresh identity (no ACL copied).', inputSchema: idOnly, mutability: 'state-transition' },
  { name: 'artifacts_set_access', description: 'Grant or revoke read/source access, or toggle public mode.', inputSchema: obj({ artifactId: str, action: { type: 'string', enum: ['grant', 'revoke', 'set-public'] }, principalId: str, grant: { type: 'string', enum: ['read', 'source'] }, isPublic: { type: 'boolean' } }, ['artifactId', 'action']), mutability: 'patch', confirm: true },
  { name: 'artifacts_promote', description: 'Select a release explicitly (expected-current CAS).', inputSchema: obj({ artifactId: str, releaseId: str, expectedCurrent: str }, ['artifactId', 'releaseId', 'expectedCurrent']), mutability: 'patch' },
  { name: 'artifacts_renew', description: 'Renew the artifact retention timestamp.', inputSchema: idOnly, mutability: 'patch' },
  { name: 'artifacts_delete', description: 'Withdraw into pending deletion (undo via artifacts_restore).', inputSchema: idOnly, mutability: 'delete', confirm: true },
  { name: 'artifacts_restore', description: 'Cancel a pending deletion or withdrawal before purge.', inputSchema: idOnly, mutability: 'state-transition' },
];

/** Kernel provider parameter schema (typed non-secret host settings). */
export const ARTIFACTS_PARAMETER_SCHEMA: ProviderParameterSchema = {
  properties: {
    defaultStorageScopeId: { type: 'string', minLength: 1, description: 'Fallback storage scope for artifacts_ensure.' },
    uploadBudgetBytes: { type: 'integer', minimum: 1, description: 'Declared bounded-upload budget.' },
  },
  required: [] as string[],
};

export interface ArtifactsManifestOptions {
  /** Host authorization profile: scope bound to every tool invocation. */
  invocationScope?: string;
  displayName?: string;
}

/** Build the sentropic.artifacts manifest (host scope bound pre-freeze). */
export function createArtifactsManifest(
  options: ArtifactsManifestOptions = {},
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
