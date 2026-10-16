/**
 * Lot 1a — Generic approved tool-configuration codec/compiler.
 *
 * A strict, pure, synchronous compiler: it accepts a versioned approved
 * snapshot, a provider manifest and a local handler binding table, and returns
 * an immutable compiled configuration or typed diagnostics BEFORE activation.
 *
 * Properties (spec-v2 §3 minimum shared contract, §5 1a):
 * - Synthetic providers only in tests; no Immo fixture, no SDK dependency,
 *   no approval service and no registry deployment in this package.
 * - Zero I/O: no fetch, no filesystem, no network, no clock. A throwing fetch
 *   anywhere in scope is never called.
 * - Whole-candidate validation: any diagnostic rejects the full candidate.
 * - The compiled configuration is deeply frozen (immutable generation).
 *
 * Reuses the manifest/runtime contracts (`AppMcpProviderManifest`,
 * `CapabilityTool`) as the capability baseline.
 */
import { createHash } from 'node:crypto';
import type { AppMcpProviderManifest, CapabilityTool } from './manifest.js';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/** Approved snapshot schema version carried by Lot 1a. */
export const TOOL_CONFIGURATION_SCHEMA_VERSION = 'v1' as const;
export type ToolConfigurationSchemaVersion = typeof TOOL_CONFIGURATION_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type ToolConfigurationDiagnosticCode =
  | 'invalid_schema_version'
  | 'invalid_identity'
  | 'manifest_digest_mismatch'
  | 'compatibility_digest_mismatch'
  | 'duplicate_tool_name'
  | 'unknown_tool'
  | 'missing_binding'
  | 'capability_ref_mismatch'
  | 'unknown_handler'
  | 'handler_capability_mismatch'
  | 'invalid_values'
  | 'unknown_config_key'
  | 'policy_weakening'
  | 'forbidden_content'
  | 'invalid_provenance'
  | 'malformed_snapshot';

export type ToolConfigurationDiagnostic = {
  code: ToolConfigurationDiagnosticCode;
  path: string;
  message: string;
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Local handler entry: compiled local code plus its typed config schema. */
export type ToolConfigurationHandlerBinding = {
  handlerId: string;
  capabilityRef: string;
  configSchema: unknown;
};

/** Per-tool policy overlay. Absent fields inherit the manifest baseline. */
export type ToolPolicyOverlay = {
  requiredScopes?: string[];
  requiredClaims?: string[];
  mutability?: CapabilityTool['mutability'];
  mutatesExternalSystem?: boolean;
  idempotency?: CapabilityTool['idempotency'];
  freshness?: CapabilityTool['freshness'];
  redactionClass?: CapabilityTool['redactionClass'];
  gates?: CapabilityTool['gates'];
};

/** One approved per-tool binding inside the snapshot. */
export type ApprovedToolBinding = {
  toolName: string;
  capabilityRef: string;
  handlerId: string;
  values: Record<string, unknown>;
  policy?: ToolPolicyOverlay;
};

/** Approval provenance. Never carries credentials, bearers or user data. */
export type ToolConfigurationProvenance = {
  approvalRef: string;
  revision: string;
  manifestDigest: string;
  payloadDigest?: string;
  reviewedBy: string[];
};

/** Versioned approved snapshot (untrusted input until compiled). */
export type ApprovedToolSnapshot = {
  schemaVersion: string;
  providerId: string;
  connectorId?: string;
  revision: string;
  manifestDigest: string;
  providerVersion?: string;
  platformVersion?: string;
  compatibilityDigest: string;
  provenance: ToolConfigurationProvenance;
  bindings: ApprovedToolBinding[];
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** One compiled per-tool entry with effective (non-weakened) policy. */
export type CompiledToolEntry = {
  toolName: string;
  capabilityRef: string;
  handlerId: string;
  values: Record<string, unknown>;
  requiredScopes: string[];
  requiredClaims: string[];
  mutability: CapabilityTool['mutability'];
  mutatesExternalSystem: boolean;
  idempotency: CapabilityTool['idempotency'];
  freshness?: CapabilityTool['freshness'];
  redactionClass: CapabilityTool['redactionClass'];
  gates: CapabilityTool['gates'];
};

/** Immutable compiled configuration (a single generation). */
export type CompiledToolConfiguration = {
  schemaVersion: ToolConfigurationSchemaVersion;
  providerId: string;
  revision: string;
  manifestDigest: string;
  compatibilityDigest: string;
  tools: CompiledToolEntry[];
};

export type CompileToolConfigurationResult =
  | { ok: true; config: CompiledToolConfiguration }
  | { ok: false; diagnostics: ToolConfigurationDiagnostic[] };

// ---------------------------------------------------------------------------
// Deterministic JSON + digests
// ---------------------------------------------------------------------------

/** Canonical JSON: object keys sorted recursively, arrays keep order. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${parts.join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Digest binding the manifest identity and full capability surface. */
export function computeManifestDigest(manifest: AppMcpProviderManifest): string {
  return sha256Hex(
    canonicalJson({
      appId: manifest.appId,
      providerId: manifest.providerId,
      version: manifest.version,
      audit: manifest.audit,
      authz: manifest.authz,
      durability: manifest.durability,
      prompts: manifest.prompts,
      resources: manifest.resources,
      tools: manifest.tools,
    }),
  );
}

/**
 * Consumer-supplied digest scope: the public tool schemas/result codec.
 * Covers exactly what configuration alone MUST NOT change: names,
 * descriptions and input/output schemas.
 */
export function computeCompatibilityDigest(manifest: AppMcpProviderManifest): string {
  const tools = [...manifest.tools]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((tool) => ({
      description: tool.description,
      inputSchema: tool.inputSchema,
      name: tool.name,
      outputSchema: tool.outputSchema,
    }));
  return sha256Hex(canonicalJson({ tools }));
}

/**
 * Payload digest over the snapshot excluding every digest envelope field, so
 * approval of the payload digest is never self-referential.
 */
export function computePayloadDigest(snapshot: ApprovedToolSnapshot): string {
  const { compatibilityDigest: _compat, manifestDigest: _manifest, provenance, ...rest } = snapshot;
  void _compat;
  void _manifest;
  const { manifestDigest: _provManifest, payloadDigest: _provPayload, ...provRest } = provenance;
  void _provManifest;
  void _provPayload;
  return sha256Hex(canonicalJson({ ...rest, provenance: provRest }));
}

// ---------------------------------------------------------------------------
// Internal guards
// ---------------------------------------------------------------------------

const HANDLER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const EXECUTABLE_VALUE_PATTERN = /^(file|https?|data|ftp|ws):/i;
const SQL_LEADER_PATTERN = /^(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC(UTE)?)\b/i;
const FORBIDDEN_VALUE_KEYS = new Set([
  'sql',
  'query',
  'url',
  'upstream',
  'import',
  'exec',
  'code',
  'script',
  'command',
]);
const FORBIDDEN_CONTENT_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'bearer',
  'access_token',
  'accesstoken',
  'refresh_token',
  'id_token',
  'private_key',
  'privatekey',
  'client_secret',
  'api_key',
  'apikey',
  'authorization',
  'credential',
  'ownersub',
  'tenant',
  'tenantref',
  'workspace',
  'workspaceref',
  'sub',
  'email',
  'userid',
  'serviceidentity',
]);
const REDACTION_ORDER = ['none', 'low', 'moderate', 'high', 'secret'] as const;

function diag(
  diagnostics: ToolConfigurationDiagnostic[],
  code: ToolConfigurationDiagnosticCode,
  path: string,
  message: string,
): void {
  diagnostics.push({ code, path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

function checkForbiddenContent(
  diagnostics: ToolConfigurationDiagnostic[],
  basePath: string,
  values: Record<string, unknown>,
): void {
  for (const [key, entry] of Object.entries(values)) {
    const lowered = key.toLowerCase().replace(/[^a-z]/g, '');
    if (FORBIDDEN_CONTENT_KEYS.has(lowered)) {
      diag(diagnostics, 'forbidden_content', `${basePath}.${key}`, `forbidden key "${key}"`);
    }
    if (FORBIDDEN_VALUE_KEYS.has(lowered)) {
      diag(diagnostics, 'forbidden_content', `${basePath}.${key}`, `executable/upstream key "${key}" is not allowed`);
    }
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (
        trimmed.startsWith('Bearer ') ||
        trimmed.startsWith('Basic ') ||
        EXECUTABLE_VALUE_PATTERN.test(trimmed) ||
        SQL_LEADER_PATTERN.test(trimmed)
      ) {
        diag(diagnostics, 'forbidden_content', `${basePath}.${key}`, `forbidden string value for "${key}"`);
      }
    } else if (isRecord(entry)) {
      checkForbiddenContent(diagnostics, `${basePath}.${key}`, entry);
    }
  }
}

// Minimal strict JSON-schema subset used for per-tool typed values.
function validateAgainstSchema(
  diagnostics: ToolConfigurationDiagnostic[],
  basePath: string,
  schema: unknown,
  values: unknown,
): boolean {
  if (!isRecord(schema)) {
    diag(diagnostics, 'invalid_values', basePath, 'handler configSchema must be an object');
    return false;
  }
  if (schema['type'] !== 'object') {
    diag(diagnostics, 'invalid_values', basePath, 'top-level configSchema type must be "object"');
    return false;
  }
  if (!isRecord(values)) {
    diag(diagnostics, 'invalid_values', basePath, 'values must be an object');
    return false;
  }
  let valid = true;
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const required = Array.isArray(schema['required'])
    ? schema['required'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  const additional = schema['additionalProperties'];
  const allowAdditional = additional === true;
  for (const name of required) {
    if (values[name] === undefined) {
      diag(diagnostics, 'invalid_values', `${basePath}.${name}`, `missing required key "${name}"`);
      valid = false;
    }
  }
  for (const [key, entry] of Object.entries(values)) {
    const subSchema = properties[key];
    const subPath = `${basePath}.${key}`;
    if (!isRecord(subSchema)) {
      if (!allowAdditional) {
        diag(diagnostics, 'unknown_config_key', subPath, `unknown key "${key}"`);
        valid = false;
      }
      continue;
    }
    if (!checkValueType(diagnostics, subPath, subSchema, entry)) valid = false;
  }
  return valid;
}

function checkValueType(
  diagnostics: ToolConfigurationDiagnostic[],
  path: string,
  schema: Record<string, unknown>,
  value: unknown,
): boolean {
  const type = schema['type'];
  if (type === 'string') {
    if (typeof value !== 'string') {
      diag(diagnostics, 'invalid_values', path, 'expected string');
      return false;
    }
    if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
      diag(diagnostics, 'invalid_values', path, 'string below minLength');
      return false;
    }
    if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) {
      diag(diagnostics, 'invalid_values', path, 'string above maxLength');
      return false;
    }
    if (Array.isArray(schema['enum']) && !schema['enum'].includes(value)) {
      diag(diagnostics, 'invalid_values', path, 'string not in enum');
      return false;
    }
    return true;
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      diag(diagnostics, 'invalid_values', path, 'expected boolean');
      return false;
    }
    return true;
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      diag(diagnostics, 'invalid_values', path, 'expected number');
      return false;
    }
    if (type === 'integer' && !Number.isInteger(value)) {
      diag(diagnostics, 'invalid_values', path, 'expected integer');
      return false;
    }
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
      diag(diagnostics, 'invalid_values', path, 'number below minimum');
      return false;
    }
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) {
      diag(diagnostics, 'invalid_values', path, 'number above maximum');
      return false;
    }
    if (Array.isArray(schema['enum']) && !schema['enum'].includes(value)) {
      diag(diagnostics, 'invalid_values', path, 'number not in enum');
      return false;
    }
    return true;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      diag(diagnostics, 'invalid_values', path, 'expected array');
      return false;
    }
    if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) {
      diag(diagnostics, 'invalid_values', path, 'array below minItems');
      return false;
    }
    if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) {
      diag(diagnostics, 'invalid_values', path, 'array above maxItems');
      return false;
    }
    if (isRecord(schema['items'])) {
      let ok = true;
      value.forEach((entry, index) => {
        if (!checkValueType(diagnostics, `${path}[${index}]`, schema['items'] as Record<string, unknown>, entry)) ok = false;
      });
      return ok;
    }
    return true;
  }
  if (type === 'object') {
    if (!isRecord(value)) {
      diag(diagnostics, 'invalid_values', path, 'expected object');
      return false;
    }
    // Reuse the object validator through a synthetic diagnostic scope.
    const nested: ToolConfigurationDiagnostic[] = [];
    const nestedSchemaOk = validateAgainstSchema(nested, path, schema, value);
    for (const entry of nested) diagnostics.push(entry);
    return nestedSchemaOk;
  }
  diag(diagnostics, 'invalid_values', path, 'unsupported schema type');
  return false;
}

function isWeakeningOverlay(manifestTool: CapabilityTool, overlay: ToolPolicyOverlay): string | null {
  if (overlay.requiredScopes !== undefined) {
    if (!Array.isArray(overlay.requiredScopes)) return 'requiredScopes must be an array';
    for (const scope of manifestTool.requiredScopes) {
      if (!overlay.requiredScopes.includes(scope)) return `requiredScopes drops manifest scope "${scope}"`;
    }
  }
  if (overlay.requiredClaims !== undefined) {
    if (!Array.isArray(overlay.requiredClaims)) return 'requiredClaims must be an array';
    for (const claim of manifestTool.requiredClaims) {
      if (!overlay.requiredClaims.includes(claim)) return `requiredClaims drops manifest claim "${claim}"`;
    }
  }
  if (overlay.mutability !== undefined && overlay.mutability !== manifestTool.mutability) {
    return 'mutability must equal the manifest baseline';
  }
  if (overlay.mutatesExternalSystem !== undefined && overlay.mutatesExternalSystem !== manifestTool.mutatesExternalSystem) {
    return 'mutatesExternalSystem must equal the manifest baseline';
  }
  if (overlay.idempotency !== undefined) {
    if (overlay.idempotency.required !== manifestTool.idempotency.required) {
      return 'idempotency.required must equal the manifest baseline';
    }
    if (
      manifestTool.idempotency.scope !== undefined &&
      overlay.idempotency.scope !== manifestTool.idempotency.scope
    ) {
      return 'idempotency.scope must equal the manifest baseline';
    }
  }
  if (overlay.freshness !== undefined) {
    if (manifestTool.freshness !== undefined) {
      if (overlay.freshness.maxAgeSeconds > manifestTool.freshness.maxAgeSeconds) {
        return 'freshness.maxAgeSeconds exceeds the manifest baseline';
      }
      if (overlay.freshness.stepUp !== manifestTool.freshness.stepUp) {
        return 'freshness.stepUp must equal the manifest baseline';
      }
    }
  }
  if (overlay.redactionClass !== undefined) {
    const base = REDACTION_ORDER.indexOf(manifestTool.redactionClass);
    const next = REDACTION_ORDER.indexOf(overlay.redactionClass);
    if (next < 0) return 'unknown redactionClass';
    if (next < base) return 'redactionClass weakens the manifest baseline';
  }
  if (overlay.gates !== undefined) {
    const pairs: Array<[keyof CapabilityTool['gates'], boolean]> = [
      ['requiresElicitation', manifestTool.gates.requiresElicitation],
      ['requiresHumanConfirmation', manifestTool.gates.requiresHumanConfirmation],
      ['requiresPrincipalGate', manifestTool.gates.requiresPrincipalGate],
    ];
    for (const [key, base] of pairs) {
      if (overlay.gates[key] !== undefined && overlay.gates[key] !== base) {
        if (base && !overlay.gates[key]) return `gates.${key} weakens the manifest baseline`;
        if (!base && overlay.gates[key]) continue;
        if (overlay.gates[key] !== base) return `gates.${key} must equal the manifest baseline`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

