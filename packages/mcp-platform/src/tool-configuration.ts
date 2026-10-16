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
  /** Payload digest the approval applies to (binds manifest + compatibility). */
  payloadDigest: string;
  /** Approval reference the payload digest was approved under. */
  approvalRef: string;
  providerVersion?: string;
  platformVersion?: string;
  /** Digest of the local handler table shape (id + capabilityRef + schema). */
  handlersDigest: string;
  tools: CompiledToolEntry[];
};

export type CompileToolConfigurationResult =
  | { ok: true; config: CompiledToolConfiguration }
  | { ok: false; diagnostics: ToolConfigurationDiagnostic[] };

// ---------------------------------------------------------------------------
// Deterministic JSON + digests
// ---------------------------------------------------------------------------

/**
 * Strict canonical JSON aligned with `sentropic-json-v1`
 * (`packages/cluster-mesh/src/messaging/canonical-json.ts`): object keys
 * sorted recursively, arrays keep order. Injective: `undefined`, non-finite
 * numbers, functions, non-plain objects and cycles are rejected instead of
 * being silently coerced to `null`/`{}` (M5).
 */
export function canonicalJson(value: unknown): string {
  return encodeCanonical(value, new Set());
}

function encodeCanonical(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Circular value is not canonical JSON');
    seen.add(value);
    const parts = value.map((entry) => encodeCanonical(entry, seen));
    seen.delete(value);
    return `[${parts.join(',')}]`;
  }
  if (typeof value !== 'object') throw new TypeError('Value is not canonical JSON');
  if (seen.has(value)) throw new TypeError('Circular value is not canonical JSON');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('JSON objects must be plain records');
  }
  seen.add(value);
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => {
      if (record[key] === undefined) throw new TypeError('Undefined is not canonical JSON');
      return `${JSON.stringify(key)}:${encodeCanonical(record[key], seen)}`;
    });
  seen.delete(value);
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
 * Payload digest over the snapshot binding every envelope field except the
 * approval's own `provenance.payloadDigest` (excluded to avoid
 * self-reference). The manifest and compatibility digests are INCLUDED, so an
 * approval of this digest cannot be re-targeted at another manifest (M3).
 */
export function computePayloadDigest(snapshot: ApprovedToolSnapshot): string {
  const { provenance, ...rest } = snapshot;
  const { payloadDigest: _omitted, ...provRest } = provenance;
  void _omitted;
  return sha256Hex(canonicalJson({ ...rest, provenance: provRest }));
}

/**
 * Code-shape digest over the local handler binding table: each entry's id,
 * capabilityRef and canonical configSchema, sorted by handlerId. Exposed on
 * the compiled configuration so 1b can bind the approved payload to the exact
 * local code shape it was compiled against (M3).
 */
export function computeHandlersDigest(
  handlers: Record<string, ToolConfigurationHandlerBinding> | Map<string, ToolConfigurationHandlerBinding>,
): string {
  const table = handlers instanceof Map ? [...handlers.values()] : Object.values(handlers ?? {});
  const entries = table
    .map((binding) => ({
      capabilityRef: binding?.capabilityRef,
      configSchema: binding?.configSchema,
      handlerId: binding?.handlerId,
    }))
    .sort((a, b) => (a.handlerId < b.handlerId ? -1 : a.handlerId > b.handlerId ? 1 : 0));
  return sha256Hex(canonicalJson({ handlers: entries }));
}

// ---------------------------------------------------------------------------
// Internal guards
// ---------------------------------------------------------------------------

const HANDLER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const EXECUTABLE_VALUE_PATTERN = /^(file|https?|ftp|ws|wss|javascript|data|node):/i;
const SQL_LEADER_PATTERN = /^(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC(UTE)?)\b/i;
const SQL_STRUCTURE_PATTERN = /(;|--|\/\*|\b(FROM|WHERE|INTO|VALUES|TABLE|JOIN|UNION)\b)/i;
const JWT_VALUE_PATTERN = /^eyJ[A-Za-z0-9_-]*\./;
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
// Normalized-only forbidden keys: keys are matched after lowercasing and
// stripping every non-letter, so underscore spellings (refresh_token,
// client_secret, ...) can never match and only normalized forms are listed.
const FORBIDDEN_CONTENT_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'bearer',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'privatekey',
  'clientsecret',
  'apikey',
  'authorization',
  'credential',
  'credentials',
  'ownersub',
  'tenant',
  'tenantid',
  'tenantref',
  'workspace',
  'workspaceid',
  'workspaceref',
  'sub',
  'email',
  'userid',
  'serviceidentity',
  'jwt',
  'token',
]);
// Substring families: any normalized key containing one of these fragments is
// forbidden (catches prefixed/suffixed token, secret, password, credential,
// apikey and privatekey spellings).
const FORBIDDEN_CONTENT_SUBSTRINGS = [
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'apikey',
  'privatekey',
  'bearer',
];
const REDACTION_ORDER = ['none', 'low', 'moderate', 'high', 'secret'] as const;

const OVERLAY_KEYS = new Set([
  'requiredScopes',
  'requiredClaims',
  'mutability',
  'mutatesExternalSystem',
  'idempotency',
  'freshness',
  'redactionClass',
  'gates',
]);

const GATE_KEYS = [
  'requiresElicitation',
  'requiresHumanConfirmation',
  'requiresPrincipalGate',
  'requiresPolicy',
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Reject malformed policy overlays with a message before any field is read.
 * A null overlay, an unknown key or a mistyped field yields a typed
 * `policy_weakening` diagnostic instead of a TypeError (M1).
 */
function checkOverlayShape(overlay: unknown): string | null {
  if (!isRecord(overlay)) return 'policy must be an object';
  for (const key of Object.keys(overlay)) {
    if (!OVERLAY_KEYS.has(key)) return `unknown policy key "${key}"`;
  }
  if (overlay.requiredScopes !== undefined && !isStringArray(overlay.requiredScopes)) {
    return 'requiredScopes must be a string array';
  }
  if (overlay.requiredClaims !== undefined && !isStringArray(overlay.requiredClaims)) {
    return 'requiredClaims must be a string array';
  }
  if (overlay.mutability !== undefined && typeof overlay.mutability !== 'string') {
    return 'mutability must be a string';
  }
  if (overlay.mutatesExternalSystem !== undefined && typeof overlay.mutatesExternalSystem !== 'boolean') {
    return 'mutatesExternalSystem must be a boolean';
  }
  if (overlay.redactionClass !== undefined && typeof overlay.redactionClass !== 'string') {
    return 'redactionClass must be a string';
  }
  if (overlay.idempotency !== undefined && !isRecord(overlay.idempotency)) {
    return 'idempotency must be an object';
  }
  if (overlay.freshness !== undefined && !isRecord(overlay.freshness)) {
    return 'freshness must be an object';
  }
  if (overlay.gates !== undefined) {
    if (!isRecord(overlay.gates)) return 'gates must be an object';
    for (const key of Object.keys(overlay.gates)) {
      if (!(GATE_KEYS as readonly string[]).includes(key)) return `unknown gates key "${key}"`;
    }
    for (const key of GATE_KEYS) {
      const value = (overlay.gates as Record<string, unknown>)[key];
      if (value !== undefined && typeof value !== 'boolean') return `gates.${key} must be a boolean`;
    }
  }
  return null;
}

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

/**
 * Deep clone JSON-like values so the compiled configuration shares no
 * reference with the caller manifest or snapshot; the later deepFreeze then
 * cannot freeze caller inputs (m4).
 */
function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => deepClone(entry)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = deepClone(entry);
  }
  return out as T;
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
    if (
      FORBIDDEN_CONTENT_KEYS.has(lowered) ||
      FORBIDDEN_CONTENT_SUBSTRINGS.some((fragment) => lowered.includes(fragment))
    ) {
      diag(diagnostics, 'forbidden_content', `${basePath}.${key}`, `forbidden key "${key}"`);
    }
    if (FORBIDDEN_VALUE_KEYS.has(lowered)) {
      diag(diagnostics, 'forbidden_content', `${basePath}.${key}`, `executable/upstream key "${key}" is not allowed`);
    }
    checkForbiddenValue(diagnostics, `${basePath}.${key}`, entry);
  }
}

function checkForbiddenValue(
  diagnostics: ToolConfigurationDiagnostic[],
  path: string,
  entry: unknown,
): void {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    // A bare SQL leader word is a legitimate label ("Select a city"); only a
    // leader combined with SQL structure (statement terminator, comment or a
    // FROM/WHERE/INTO/VALUES/TABLE/JOIN/UNION clause) is treated as SQL.
    if (
      trimmed.startsWith('Bearer ') ||
      trimmed.startsWith('Basic ') ||
      trimmed.startsWith('//') ||
      EXECUTABLE_VALUE_PATTERN.test(trimmed) ||
      JWT_VALUE_PATTERN.test(trimmed) ||
      (SQL_LEADER_PATTERN.test(trimmed) && SQL_STRUCTURE_PATTERN.test(trimmed))
    ) {
      diag(diagnostics, 'forbidden_content', path, `forbidden string value at "${path}"`);
    }
    return;
  }
  if (Array.isArray(entry)) {
    entry.forEach((item, index) => checkForbiddenValue(diagnostics, `${path}[${index}]`, item));
    return;
  }
  if (isRecord(entry)) {
    checkForbiddenContent(diagnostics, path, entry);
  }
}

// Closed strict JSON-schema subset used for per-tool typed values: only the
// listed keywords are supported and every other keyword is rejected (m1).
const OBJECT_SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties']);
const STRING_SCHEMA_KEYS = new Set(['type', 'minLength', 'maxLength', 'enum']);
const NUMBER_SCHEMA_KEYS = new Set(['type', 'minimum', 'maximum', 'enum']);
const BOOLEAN_SCHEMA_KEYS = new Set(['type']);
const ARRAY_SCHEMA_KEYS = new Set(['type', 'minItems', 'maxItems', 'items']);

function checkSchemaKeys(
  diagnostics: ToolConfigurationDiagnostic[],
  path: string,
  schema: Record<string, unknown>,
  allowed: Set<string>,
): boolean {
  let ok = true;
  for (const key of Object.keys(schema)) {
    if (!allowed.has(key)) {
      diag(diagnostics, 'invalid_values', path, `unsupported schema keyword "${key}"`);
      ok = false;
    }
  }
  return ok;
}

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
  if (!checkSchemaKeys(diagnostics, basePath, schema, OBJECT_SCHEMA_KEYS)) valid = false;
  if (schema['properties'] !== undefined && !isRecord(schema['properties'])) {
    diag(diagnostics, 'invalid_values', basePath, 'schema properties must be an object');
    valid = false;
  }
  if (
    schema['required'] !== undefined &&
    !(Array.isArray(schema['required']) && schema['required'].every((entry) => typeof entry === 'string'))
  ) {
    diag(diagnostics, 'invalid_values', basePath, 'schema required must be a string array');
    valid = false;
  }
  if (schema['additionalProperties'] !== undefined && typeof schema['additionalProperties'] !== 'boolean') {
    diag(diagnostics, 'invalid_values', basePath, 'schema additionalProperties must be a boolean');
    valid = false;
  }
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
    if (!checkSchemaKeys(diagnostics, path, schema, STRING_SCHEMA_KEYS)) return false;
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
    if (!checkSchemaKeys(diagnostics, path, schema, BOOLEAN_SCHEMA_KEYS)) return false;
    if (typeof value !== 'boolean') {
      diag(diagnostics, 'invalid_values', path, 'expected boolean');
      return false;
    }
    return true;
  }
  if (type === 'number' || type === 'integer') {
    if (!checkSchemaKeys(diagnostics, path, schema, NUMBER_SCHEMA_KEYS)) return false;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
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
    if (!checkSchemaKeys(diagnostics, path, schema, ARRAY_SCHEMA_KEYS)) return false;
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
    const idempotency = overlay.idempotency as Record<string, unknown>;
    for (const key of Object.keys(idempotency)) {
      if (key !== 'required' && key !== 'scope') return `unknown idempotency key "${key}"`;
    }
    if (typeof idempotency.required !== 'boolean') return 'idempotency.required must be a boolean';
    if (idempotency.required !== manifestTool.idempotency.required) {
      return 'idempotency.required must equal the manifest baseline';
    }
    if (idempotency.scope !== undefined && typeof idempotency.scope !== 'string') {
      return 'idempotency.scope must be a string';
    }
    if (idempotency.scope !== manifestTool.idempotency.scope) {
      return 'idempotency.scope must equal the manifest baseline';
    }
  }
  if (overlay.freshness !== undefined) {
    const freshness = overlay.freshness as Record<string, unknown>;
    for (const key of Object.keys(freshness)) {
      if (key !== 'maxAgeSeconds' && key !== 'acr' && key !== 'amr' && key !== 'stepUp') {
        return `unknown freshness key "${key}"`;
      }
    }
    const base = manifestTool.freshness;
    const maxAge = freshness.maxAgeSeconds !== undefined ? freshness.maxAgeSeconds : base?.maxAgeSeconds;
    if (typeof maxAge !== 'number' || !Number.isFinite(maxAge) || maxAge <= 0) {
      return 'freshness.maxAgeSeconds must be a finite number > 0';
    }
    if (base !== undefined && maxAge > base.maxAgeSeconds) {
      return 'freshness.maxAgeSeconds exceeds the manifest baseline';
    }
    const stepUp = freshness.stepUp !== undefined ? freshness.stepUp : base?.stepUp;
    if (typeof stepUp !== 'string' || (stepUp !== 'auth' && stepUp !== 'scope' && stepUp !== 'either')) {
      return 'freshness.stepUp must be a known step-up value';
    }
    if (base !== undefined && stepUp !== base.stepUp) {
      return 'freshness.stepUp must equal the manifest baseline';
    }
    for (const key of ['acr', 'amr'] as const) {
      const value = freshness[key] !== undefined ? freshness[key] : base?.[key];
      if (value !== undefined) {
        if (!isStringArray(value)) return `freshness.${key} must be a string array`;
        for (const entry of base?.[key] ?? []) {
          if (!value.includes(entry)) return `freshness.${key} drops manifest value "${entry}"`;
        }
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
      ['requiresPolicy', manifestTool.gates.requiresPolicy ?? false],
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

export type CompileToolConfigurationInput = {
  snapshot: unknown;
  manifest: AppMcpProviderManifest;
  handlers: Record<string, ToolConfigurationHandlerBinding> | Map<string, ToolConfigurationHandlerBinding>;
};

/**
 * Strictly compile an approved snapshot against a manifest and a local handler
 * table. Pure and synchronous: performs zero I/O and never touches fetch,
 * the filesystem, the network or the clock.
 */
export function compileToolConfiguration(input: CompileToolConfigurationInput): CompileToolConfigurationResult {
  const diagnostics: ToolConfigurationDiagnostic[] = [];
  const snapshot = input.snapshot as Partial<ApprovedToolSnapshot> | null | undefined;
  const manifest = input.manifest;
  const handlerTable: Map<string, ToolConfigurationHandlerBinding> =
    input.handlers instanceof Map
      ? input.handlers
      : new Map(Object.entries(input.handlers ?? {}));

  if (!isRecord(snapshot)) {
    diag(diagnostics, 'malformed_snapshot', 'snapshot', 'snapshot must be an object');
    return { ok: false, diagnostics };
  }

  // Identity / version.
  if (snapshot.schemaVersion !== TOOL_CONFIGURATION_SCHEMA_VERSION) {
    diag(diagnostics, 'invalid_schema_version', 'snapshot.schemaVersion', 'schemaVersion must be "v1"');
  }
  if (typeof snapshot.providerId !== 'string' || snapshot.providerId.length === 0) {
    diag(diagnostics, 'invalid_identity', 'snapshot.providerId', 'providerId must be a non-empty string');
  } else if (snapshot.providerId !== manifest.providerId) {
    diag(diagnostics, 'invalid_identity', 'snapshot.providerId', 'providerId must equal the manifest providerId');
  }
  if (typeof snapshot.revision !== 'string' || snapshot.revision.length === 0) {
    diag(diagnostics, 'invalid_identity', 'snapshot.revision', 'revision must be a non-empty string');
  }

  // Digest inputs may carry non-canonical values (undefined, non-finite
  // numbers); an unencodable manifest fails closed with a diagnostic (M5).
  let manifestDigest = '';
  let compatibilityDigest = '';
  try {
    manifestDigest = computeManifestDigest(manifest);
    compatibilityDigest = computeCompatibilityDigest(manifest);
  } catch {
    diag(diagnostics, 'manifest_digest_mismatch', 'snapshot.manifestDigest', 'manifest cannot be canonically encoded');
    return { ok: false, diagnostics };
  }
  if (snapshot.manifestDigest !== manifestDigest) {
    diag(diagnostics, 'manifest_digest_mismatch', 'snapshot.manifestDigest', 'manifestDigest does not match the manifest');
  }
  if (snapshot.compatibilityDigest !== compatibilityDigest) {
    diag(
      diagnostics,
      'compatibility_digest_mismatch',
      'snapshot.compatibilityDigest',
      'compatibilityDigest does not cover the manifest public schemas',
    );
  }

  // Provenance.
  const provenance = snapshot.provenance as Partial<ToolConfigurationProvenance> | undefined;
  if (!isRecord(provenance)) {
    diag(diagnostics, 'invalid_provenance', 'snapshot.provenance', 'provenance must be an object');
  } else {
    if (typeof provenance.approvalRef !== 'string' || provenance.approvalRef.length === 0) {
      diag(diagnostics, 'invalid_provenance', 'snapshot.provenance.approvalRef', 'approvalRef must be non-empty');
    }
    if (typeof provenance.revision !== 'string' || provenance.revision.length === 0) {
      diag(diagnostics, 'invalid_provenance', 'snapshot.provenance.revision', 'provenance revision must be non-empty');
    } else if (typeof snapshot.revision === 'string' && provenance.revision !== snapshot.revision) {
      diag(diagnostics, 'invalid_provenance', 'snapshot.provenance.revision', 'provenance revision must equal snapshot revision');
    }
    if (provenance.manifestDigest !== manifestDigest) {
      diag(diagnostics, 'manifest_digest_mismatch', 'snapshot.provenance.manifestDigest', 'provenance manifestDigest mismatch');
    }
    if (
      !Array.isArray(provenance.reviewedBy) ||
      provenance.reviewedBy.length === 0 ||
      !provenance.reviewedBy.every((entry) => typeof entry === 'string' && entry.length > 0)
    ) {
      diag(diagnostics, 'invalid_provenance', 'snapshot.provenance.reviewedBy', 'reviewedBy must list at least one reviewer');
    }
    // The payload digest is mandatory: approval applies to it, and it binds
    // the manifest and compatibility digests (M3).
    if (typeof provenance.payloadDigest !== 'string' || provenance.payloadDigest.length === 0) {
      diag(diagnostics, 'invalid_provenance', 'snapshot.provenance.payloadDigest', 'payloadDigest is mandatory and must be non-empty');
    } else {
      const full = snapshot as ApprovedToolSnapshot;
      let expected: string | null = null;
      try {
        expected = computePayloadDigest(full);
      } catch {
        expected = null;
      }
      if (expected === null || provenance.payloadDigest !== expected) {
        diag(diagnostics, 'invalid_provenance', 'snapshot.provenance.payloadDigest', 'payloadDigest does not match the payload');
      }
    }
  }

  // Bindings shape.
  const bindings = snapshot.bindings;
  if (!Array.isArray(bindings)) {
    diag(diagnostics, 'malformed_snapshot', 'snapshot.bindings', 'bindings must be an array');
    return { ok: false, diagnostics };
  }

  const manifestTools = new Map<string, CapabilityTool>(manifest.tools.map((tool) => [tool.name, tool]));
  const seen = new Set<string>();
  const compiled: CompiledToolEntry[] = [];

  bindings.forEach((binding, index) => {
    const path = `snapshot.bindings[${index}]`;
    if (!isRecord(binding)) {
      diag(diagnostics, 'malformed_snapshot', path, 'binding must be an object');
      return;
    }
    const entry = binding as Partial<ApprovedToolBinding>;
    if (typeof entry.toolName !== 'string' || entry.toolName.length === 0) {
      diag(diagnostics, 'malformed_snapshot', `${path}.toolName`, 'toolName must be non-empty');
      return;
    }
    if (seen.has(entry.toolName)) {
      diag(diagnostics, 'duplicate_tool_name', `${path}.toolName`, `duplicate tool "${entry.toolName}"`);
      return;
    }
    seen.add(entry.toolName);

    const manifestTool = manifestTools.get(entry.toolName);
    if (!manifestTool) {
      diag(diagnostics, 'unknown_tool', `${path}.toolName`, `unknown tool "${entry.toolName}"`);
      return;
    }
    if (entry.capabilityRef !== entry.toolName) {
      diag(diagnostics, 'capability_ref_mismatch', `${path}.capabilityRef`, 'capabilityRef must equal toolName');
      return;
    }
    if (typeof entry.handlerId !== 'string' || !HANDLER_ID_PATTERN.test(entry.handlerId)) {
      diag(diagnostics, 'unknown_handler', `${path}.handlerId`, 'handlerId must reference local compiled code');
      return;
    }
    const handler = handlerTable.get(entry.handlerId);
    if (!handler) {
      diag(diagnostics, 'unknown_handler', `${path}.handlerId`, `unknown handler "${entry.handlerId}"`);
      return;
    }
    if (handler.capabilityRef !== entry.toolName) {
      diag(diagnostics, 'handler_capability_mismatch', `${path}.handlerId`, 'handler capabilityRef mismatch');
      return;
    }
    if (!isRecord(entry.values)) {
      diag(diagnostics, 'invalid_values', `${path}.values`, 'values must be an object');
      return;
    }
    checkForbiddenContent(diagnostics, `${path}.values`, entry.values);
    const before = diagnostics.length;
    validateAgainstSchema(diagnostics, `${path}.values`, handler.configSchema, entry.values);
    if (diagnostics.length !== before) return;

    if (entry.policy !== undefined) {
      const shapeError = checkOverlayShape(entry.policy);
      if (shapeError) {
        diag(diagnostics, 'policy_weakening', `${path}.policy`, shapeError);
        return;
      }
      const weakening = isWeakeningOverlay(manifestTool, entry.policy as ToolPolicyOverlay);
      if (weakening) {
        diag(diagnostics, 'policy_weakening', `${path}.policy`, weakening);
        return;
      }
    }

    const policy = (entry.policy ?? {}) as ToolPolicyOverlay;
    // Field-by-field merge: an absent overlay field inherits the manifest
    // baseline, so `gates: {}` or a partial freshness object can never drop a
    // required gate, age bound, acr or amr entry (B1).
    const mergedGates = { ...manifestTool.gates, ...policy.gates };
    const mergedFreshness =
      policy.freshness === undefined && manifestTool.freshness === undefined
        ? undefined
        : ({ ...manifestTool.freshness, ...policy.freshness } as CapabilityTool['freshness']);
    const mergedIdempotency = { ...manifestTool.idempotency, ...policy.idempotency };
    compiled.push({
      capabilityRef: entry.toolName,
      ...(mergedFreshness !== undefined ? { freshness: deepClone(mergedFreshness) } : {}),
      gates: mergedGates,
      handlerId: entry.handlerId,
      idempotency: mergedIdempotency,
      mutability: policy.mutability ?? manifestTool.mutability,
      mutatesExternalSystem: policy.mutatesExternalSystem ?? manifestTool.mutatesExternalSystem,
      redactionClass: policy.redactionClass ?? manifestTool.redactionClass,
      requiredClaims: policy.requiredClaims ?? [...manifestTool.requiredClaims],
      requiredScopes: policy.requiredScopes ?? [...manifestTool.requiredScopes],
      toolName: entry.toolName,
      values: deepClone(entry.values as Record<string, unknown>),
    });
  });

  // Exact coverage: configuration alone cannot rename, remove or add a tool.
  for (const name of manifestTools.keys()) {
    if (!seen.has(name)) {
      diag(diagnostics, 'missing_binding', `snapshot.bindings.${name}`, `missing binding for "${name}"`);
    }
  }

  const approval = snapshot.provenance as ToolConfigurationProvenance;
  let handlersDigest = '';
  try {
    handlersDigest = computeHandlersDigest(input.handlers);
  } catch {
    diag(diagnostics, 'unknown_handler', 'handlers', 'handler table cannot be canonically encoded');
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const config: CompiledToolConfiguration = {
    approvalRef: approval.approvalRef,
    compatibilityDigest,
    handlersDigest,
    manifestDigest,
    ...(typeof snapshot.providerVersion === 'string' ? { providerVersion: snapshot.providerVersion } : {}),
    ...(typeof snapshot.platformVersion === 'string' ? { platformVersion: snapshot.platformVersion } : {}),
    payloadDigest: approval.payloadDigest as string,
    providerId: manifest.providerId,
    revision: snapshot.revision as string,
    schemaVersion: TOOL_CONFIGURATION_SCHEMA_VERSION,
    tools: [...compiled].sort((a, b) => (a.toolName < b.toolName ? -1 : a.toolName > b.toolName ? 1 : 0)),
  };
  compiledBrands.add(config);
  return { ok: true, config: deepFreeze(config) };
}

// ---------------------------------------------------------------------------
// Active generation fencing
// ---------------------------------------------------------------------------

export type ActivateToolConfigurationResult =
  | { ok: true; config: CompiledToolConfiguration }
  | { ok: false; diagnostics: ToolConfigurationDiagnostic[] };

/**
 * Brand of configurations produced by `compileToolConfiguration`. `activate`
 * only accepts branded configurations, so a hand-built `{ ok: true, config }`
 * can never bypass compilation (m5).
 */
const compiledBrands = new WeakSet<object>();

/**
 * Active-generation holder. An invalid candidate retains the active
 * generation; a cold start without a valid embedded configuration fails
 * before replacing any working instance.
 */
export class ToolConfigurationStore {
  private active: CompiledToolConfiguration | null = null;
  private generation = 0;

  getActive(): CompiledToolConfiguration | null {
    return this.active;
  }

  /** Monotonic count of successful activations (fencing token). */
  getGeneration(): number {
    return this.generation;
  }

  activate(result: CompileToolConfigurationResult): ActivateToolConfigurationResult {
    if (!result.ok) return result;
    if (!compiledBrands.has(result.config)) {
      return {
        ok: false,
        diagnostics: [
          { code: 'malformed_snapshot', path: 'config', message: 'configuration was not produced by compileToolConfiguration' },
        ],
      };
    }
    this.active = result.config;
    this.generation += 1;
    return { ok: true, config: result.config };
  }

  compileAndActivate(input: CompileToolConfigurationInput): ActivateToolConfigurationResult {
    return this.activate(compileToolConfiguration(input));
  }

  coldStart(input: CompileToolConfigurationInput): CompiledToolConfiguration {
    const result = compileToolConfiguration(input);
    if (!result.ok) {
      const first = result.diagnostics[0];
      throw new Error(`invalid embedded tool configuration: ${first?.code ?? 'unknown'} at ${first?.path ?? 'snapshot'}`);
    }
    this.active = result.config;
    this.generation += 1;
    return result.config;
  }
}
