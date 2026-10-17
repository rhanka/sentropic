/**
 * L-5e — reusable web-pages MCP provider (spec-v8 §9 5e, review B3).
 *
 * Part 1: identity, the 15 exact `artifacts_*` tool specs with closed input
 * schemas, and the platform manifest. The logical provider ID is
 * `sentropic.web-pages`; the generic provider hardcodes no application
 * OAuth vocabulary — a host binds its invocation scope through the
 * manifest factory before digests freeze (§3.5). Part 2 adds the tool
 * executor over the same HTTP app direct calls use; part 3 adds the
 * platform adapter and the kernel registry definition (§3).
 */
import type { AppMcpProviderManifest, CapabilityTool } from '@sentropic/mcp-platform';

export const WEB_PAGES_PROVIDER_ID = 'sentropic.web-pages';
export const WEB_PAGES_APP_ID = 'sentropic-artifacts';
export const WEB_PAGES_PROVIDER_VERSION = '0.1.0';

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
const fileEntry = obj({ path: str, mimeType: str, bytes: fileBytes }, ['path', 'mimeType', 'bytes']);
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
export const WEB_PAGES_PARAMETER_SCHEMA = {
  properties: {
    defaultStorageScopeId: { type: 'string', minLength: 1, description: 'Fallback storage scope for artifacts_ensure.' },
    uploadBudgetBytes: { type: 'integer', minimum: 1, description: 'Declared bounded-upload budget.' },
  },
  required: [] as string[],
};

export interface WebPagesManifestOptions {
  /** Host authorization profile: scope bound to every tool invocation. */
  invocationScope?: string;
  displayName?: string;
}

/** Build the sentropic.web-pages manifest (host scope bound pre-freeze). */
export function createWebPagesManifest(
  options: WebPagesManifestOptions = {},
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
    appId: WEB_PAGES_APP_ID,
    providerId: WEB_PAGES_PROVIDER_ID,
    version: WEB_PAGES_PROVIDER_VERSION,
    displayName: options.displayName ?? 'Sentropic Web Pages',
    resources: [],
    tools,
    prompts: [],
    authz: { requiredClaims: [], scopes: [...scopes], tenantResolution: 'custom-resolver' },
    audit: { eventKinds: ['invoke'] },
    durability: {},
  };
}
