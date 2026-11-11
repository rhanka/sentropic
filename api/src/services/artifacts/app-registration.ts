import { createHash } from 'node:crypto';
import { ARTIFACTS_TOOL_DEFINITIONS } from '@sentropic/artifacts/mcp-core';

const HEX64 = /^[0-9a-f]{64}$/;
const SCOPE_ID = /^[A-Za-z0-9_-]+$/;
const UUID36 = /^[0-9a-f-]{36}$/;
const RESERVED_PREFIXES = ['app-artifact-', 'artifact-'];

export interface AppArtifactsRegistration {
  appInstanceId: string;
  appSlug: string;
  environment: 'preprod' | 'prod';
  tenantId: string;
  workspaceId: string;
  storage: {
    storageScopeId: string;
    origin: 'native' | 'imported';
    quotaBytes: number;
    placement: 'db' | 's3' | 'db+s3';
    inlineMaxBytes?: number;
    actorQuotas?: { maxBytes: number; ratePerWindow: number; windowSeconds: number };
  };
  profile: { selectedCapabilities: string[]; profileDigest: string; manifestDigest: string };
  presentation: { toolSummaries: Record<string, string>; toolDefinitionsDigest: string };
  mcp: { resource: string; clientIds: string[] };
  knowledge: { repoId: string; commitSha: string; path: string; digest: string };
  embedding?: { frameAncestors: string[] };
  viewAddress?: { appOrigin: string; contentBaseDomains: string[]; nonRoutingHosts: string[] };
  domain?: unknown;
  revision: string;
  reviewedBy: string[];
}

export const isRegistrationEnabled = (): boolean => process.env.CM_REGISTRATION_ENABLED === '1';

export const isStrictHttpsOrigin = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password;
  } catch { return false; };
};

export const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; };
};

const sha256Hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new Error('not_canonical_json');
};

const isHex40 = (value: unknown): boolean => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

export interface CanonicalPerAppTool { name: string; description: string; inputSchema: unknown }

export function buildCanonicalPerAppTools(selectedCapabilities: string[], toolSummaries: Record<string, string>): CanonicalPerAppTool[] {
  const selected = new Set(selectedCapabilities);
  return Object.entries(ARTIFACTS_TOOL_DEFINITIONS)
    .filter(([name]) => selected.has(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, tool]) => ({
      name,
      description: toolSummaries[name] ?? tool.description,
      inputSchema: tool.inputSchema,
    }));
}

export function computeProfileDigest(selectedCapabilities: string[]): string {
  return sha256Hex(canonicalJson([...selectedCapabilities].sort()));
}

export function computeToolDefinitionsDigest(tools: CanonicalPerAppTool[]): string {
  return sha256Hex(canonicalJson(tools));
}

export function computeManifestDigest(profileDigest: string, toolDefinitionsDigest: string, resource: string): string {
  return sha256Hex(canonicalJson({ profileDigest, resource, toolDefinitionsDigest }));
}

export function getToolMutability(toolName: string): string | undefined {
  return (ARTIFACTS_TOOL_DEFINITIONS as Record<string, { mutability: string }>)[toolName]?.mutability;
}

export function isWriteTool(toolName: string): boolean {
  return getToolMutability(toolName) !== 'read-only';
}

export interface ProjectedAppInstance {
  id: string;
  tenantId: string;
  environment: string;
  controlEnvironment: 'prod' | 'preview' | 'local';
  workspaceId: string;
  storageScopeId: string;
  storageOrigin: 'native' | 'imported';
  mcpResource: string;
  desiredState: { appSlug: string; registrationRevision: string };
}

export function projectAppInstance(registration: AppArtifactsRegistration): ProjectedAppInstance {
  return {
    id: registration.appInstanceId,
    tenantId: registration.tenantId,
    environment: registration.environment,
    controlEnvironment: registration.environment === 'prod' ? 'prod' : 'preview',
    workspaceId: registration.workspaceId,
    storageScopeId: registration.storage.storageScopeId,
    storageOrigin: registration.storage.origin,
    mcpResource: registration.mcp.resource,
    desiredState: { appSlug: registration.appSlug, registrationRevision: registration.revision },
  };
}

/** Fail-closed validation of §3.1. Returns refusal reason, never throws on bad input. */
export function validateAppRegistration(input: unknown): { ok: true; value: AppArtifactsRegistration } | { ok: false; reason: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, reason: 'not_an_object' };
  const r = input as Record<string, unknown>;
  if (typeof r.appInstanceId !== 'string' || !r.appInstanceId) return { ok: false, reason: 'unknown_app_instance' };
  if (typeof r.appSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(r.appSlug)) return { ok: false, reason: 'slug_collision' };
  if (r.environment !== 'preprod' && r.environment !== 'prod') return { ok: false, reason: 'unknown_environment' };
  if (typeof r.tenantId !== 'string' || !r.tenantId) return { ok: false, reason: 'tenant_mismatch' };
  if (typeof r.workspaceId !== 'string' || !r.workspaceId) return { ok: false, reason: 'unknown_workspace' };
  const storage = r.storage as Record<string, unknown> | undefined;
  if (typeof storage !== 'object' || storage === null) return { ok: false, reason: 'unknown_storage' };
  const scopeId = storage.storageScopeId;
  if (storage.origin !== 'native' && storage.origin !== 'imported') return { ok: false, reason: 'unknown_origin' };
  if (storage.origin === 'native') {
    if (typeof scopeId !== 'string' || !UUID36.test(scopeId)) return { ok: false, reason: 'imported_scope_invalid' };
  } else {
    if (typeof scopeId !== 'string' || !SCOPE_ID.test(scopeId)) return { ok: false, reason: 'imported_scope_invalid' };
    if (RESERVED_PREFIXES.some((p) => scopeId.startsWith(p)) || scopeId.includes('/')) {
      return { ok: false, reason: 'imported_scope_reserved' };
    }
  }
  if (!Number.isSafeInteger(storage.quotaBytes) || (storage.quotaBytes as number) <= 0) {
    return { ok: false, reason: 'quota_refused' };
  }
  if (!['db', 's3', 'db+s3'].includes(storage.placement as string)) return { ok: false, reason: 'placement_not_offered' };
  if (storage.placement === 'db+s3') {
    const inline = (storage as { inlineMaxBytes?: unknown }).inlineMaxBytes;
    if (inline !== undefined && (!Number.isSafeInteger(inline) || (inline as number) <= 0)) {
      return { ok: false, reason: 'quota_refused' };
    }
  }
  const actorQuotas = (storage as { actorQuotas?: unknown }).actorQuotas as
    { maxBytes?: unknown; ratePerWindow?: unknown; windowSeconds?: unknown } | undefined;
  if (actorQuotas !== undefined) {
    const { maxBytes, ratePerWindow, windowSeconds } = actorQuotas;
    if (!Number.isSafeInteger(maxBytes) || (maxBytes as number) <= 0 ||
      !Number.isSafeInteger(ratePerWindow) || (ratePerWindow as number) <= 0 ||
      !Number.isSafeInteger(windowSeconds) || (windowSeconds as number) <= 0) {
      return { ok: false, reason: 'quota_refused' };
    }
  }
  // Placement routing needs the CMF-S1/S2 blob bridge from part A storage lane; stubbed here.
  const profile = r.profile as Record<string, unknown> | undefined;
  if (typeof profile !== 'object' || profile === null || !Array.isArray(profile.selectedCapabilities) ||
    typeof profile.profileDigest !== 'string' || !HEX64.test(profile.profileDigest) ||
    typeof profile.manifestDigest !== 'string' || !HEX64.test(profile.manifestDigest)) {
    return { ok: false, reason: 'profile_digest_mismatch' };
  }
  const selected = profile.selectedCapabilities as unknown[];
  if (!selected.length || new Set(selected).size !== selected.length ||
    selected.some((name) => typeof name !== 'string' ||
      !(ARTIFACTS_TOOL_DEFINITIONS as Record<string, unknown>)[name])) {
    return { ok: false, reason: 'profile_digest_mismatch' };
  }
  const selectedNames = selected as string[];
  if (computeProfileDigest(selectedNames) !== profile.profileDigest) {
    return { ok: false, reason: 'profile_digest_mismatch' };
  }
  const presentation = r.presentation as Record<string, unknown> | undefined;
  if (typeof presentation !== 'object' || presentation === null ||
    typeof presentation.toolSummaries !== 'object' || presentation.toolSummaries === null ||
    typeof presentation.toolDefinitionsDigest !== 'string' || !HEX64.test(presentation.toolDefinitionsDigest as string)) {
    return { ok: false, reason: 'served_definitions_digest_mismatch' };
  }
  const summaries = presentation.toolSummaries as Record<string, string>;
  if (Object.entries(summaries).some(([name, text]) =>
    typeof text !== 'string' || !text || !(ARTIFACTS_TOOL_DEFINITIONS as Record<string, unknown>)[name])) {
    return { ok: false, reason: 'served_definitions_digest_mismatch' };
  }
  const mcp = r.mcp as Record<string, unknown> | undefined;
  if (typeof mcp !== 'object' || mcp === null || typeof mcp.resource !== 'string' ||
    !isHttpsUrl(mcp.resource) || !mcp.resource.includes('/api/v1/mcp/apps/') ||
    !Array.isArray(mcp.clientIds) || mcp.clientIds.some((id) => typeof id !== 'string' || !id)) {
    return { ok: false, reason: 'unknown_mcp_resource' };
  }
  const canonicalTools = buildCanonicalPerAppTools(selectedNames, summaries);
  if (computeToolDefinitionsDigest(canonicalTools) !== presentation.toolDefinitionsDigest) {
    return { ok: false, reason: 'served_definitions_digest_mismatch' };
  }
  if (computeManifestDigest(profile.profileDigest as string,
    presentation.toolDefinitionsDigest as string, mcp.resource as string) !== profile.manifestDigest) {
    return { ok: false, reason: 'profile_digest_mismatch' };
  }
  const knowledge = r.knowledge as Record<string, unknown> | undefined;
  if (typeof knowledge !== 'object' || knowledge === null || typeof knowledge.repoId !== 'string' || !knowledge.repoId ||
    !isHex40(knowledge.commitSha) || typeof knowledge.path !== 'string' || !knowledge.path ||
    knowledge.path.includes('..') ||
    typeof knowledge.digest !== 'string' || !HEX64.test(knowledge.digest as string)) {
    return { ok: false, reason: 'knowledge_digest_mismatch' };
  }
  const embedding = r.embedding as { frameAncestors?: unknown } | undefined;
  if (embedding !== undefined && (!Array.isArray(embedding.frameAncestors) ||
    !embedding.frameAncestors.every(isStrictHttpsOrigin))) return { ok: false, reason: 'frame_ancestors_refused' };
  const view = r.viewAddress as { appOrigin?: unknown; contentBaseDomains?: unknown; nonRoutingHosts?: unknown } | undefined;
  if (view !== undefined) {
    if (view.appOrigin !== undefined && !isStrictHttpsOrigin(view.appOrigin)) {
      return { ok: false, reason: 'content_domain_collision' };
    }
    const bases = view.contentBaseDomains;
    if (bases !== undefined && (!Array.isArray(bases) ||
      !bases.every((d: unknown) => typeof d === 'string' && !!d))) {
      return { ok: false, reason: 'content_domain_collision' };
    }
  }
  if (r.domain !== undefined) return { ok: false, reason: 'domain_not_enabled_in_t4a' };
  if (typeof r.revision !== 'string' || !r.revision || !Array.isArray(r.reviewedBy) || !r.reviewedBy.length) {
    return { ok: false, reason: 'revision_not_reviewed' };
  }
  return { ok: true, value: r as unknown as AppArtifactsRegistration };
}

/** Load registrations from env. Disabled flag returns empty, never throws on bad rows. */
export function loadAppRegistrationsFromEnv(): { loaded: AppArtifactsRegistration[]; refused: { index: number; reason: string }[] } {
  if (!isRegistrationEnabled()) return { loaded: [], refused: [] };
  const raw = process.env.APP_ARTIFACT_REGISTRATIONS_JSON;
  if (!raw) return { loaded: [], refused: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { loaded: [], refused: [{ index: -1, reason: 'unparseable' }] }; }
  if (!Array.isArray(parsed)) return { loaded: [], refused: [{ index: -1, reason: 'not_an_array' }] };
  const loaded: AppArtifactsRegistration[] = [];
  const refused: { index: number; reason: string }[] = [];
  const seenSlugs = new Map<string, number>();
  const seenInstances = new Map<string, number>();
  const seenScopes = new Map<string, number>();
  const seenResources = new Map<string, number>();
  const seenDomains = new Map<string, number>();
  parsed.forEach((entry, index) => {
    const result = validateAppRegistration(entry);
    if (!result.ok) {
      refused.push({ index, reason: result.reason });
      return;
    }
    const value = result.value;
    const collisions: { key: string; seen: Map<string, number>; reason: string }[] = [
      { key: `${value.appSlug}:${value.environment}`, seen: seenSlugs, reason: 'slug_collision' },
      { key: value.appInstanceId, seen: seenInstances, reason: 'instance_collision' },
      { key: value.storage.storageScopeId, seen: seenScopes, reason: 'scope_collision' },
      { key: value.mcp.resource, seen: seenResources, reason: 'resource_collision' },
    ];
    for (const { key, seen, reason } of collisions) {
      if (seen.has(key)) {
        refused.push({ index, reason });
        return;
      }
    }
    const domains = value.viewAddress?.contentBaseDomains ?? [];
    for (const domain of domains) {
      if (seenDomains.has(domain)) {
        refused.push({ index, reason: 'content_domain_collision' });
        return;
      }
    }
    collisions.forEach(({ key, seen }) => seen.set(key, index));
    domains.forEach((domain) => seenDomains.set(domain, index));
    loaded.push(value);
  });
  return { loaded, refused };
}
