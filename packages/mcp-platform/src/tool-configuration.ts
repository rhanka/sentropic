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

  const manifestDigest = computeManifestDigest(manifest);
  if (snapshot.manifestDigest !== manifestDigest) {
    diag(diagnostics, 'manifest_digest_mismatch', 'snapshot.manifestDigest', 'manifestDigest does not match the manifest');
  }
  const compatibilityDigest = computeCompatibilityDigest(manifest);
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
    if (!Array.isArray(provenance.reviewedBy) || provenance.reviewedBy.length === 0) {
      diag(diagnostics, 'invalid_provenance', 'snapshot.provenance.reviewedBy', 'reviewedBy must list at least one reviewer');
    }
    if (provenance.payloadDigest !== undefined && typeof provenance.payloadDigest === 'string') {
      const full = snapshot as ApprovedToolSnapshot;
      const expected = computePayloadDigest(full);
      if (provenance.payloadDigest !== expected) {
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
      if (!isRecord(entry.policy)) {
        diag(diagnostics, 'policy_weakening', `${path}.policy`, 'policy must be an object');
        return;
      }
      const weakening = isWeakeningOverlay(manifestTool, entry.policy as ToolPolicyOverlay);
      if (weakening) {
        diag(diagnostics, 'policy_weakening', `${path}.policy`, weakening);
        return;
      }
    }

    const policy = (entry.policy ?? {}) as ToolPolicyOverlay;
    compiled.push({
      capabilityRef: entry.toolName,
      freshness: policy.freshness ?? manifestTool.freshness,
      gates: policy.gates ?? manifestTool.gates,
      handlerId: entry.handlerId,
      idempotency: policy.idempotency ?? manifestTool.idempotency,
      mutability: policy.mutability ?? manifestTool.mutability,
      mutatesExternalSystem: policy.mutatesExternalSystem ?? manifestTool.mutatesExternalSystem,
      redactionClass: policy.redactionClass ?? manifestTool.redactionClass,
      requiredClaims: policy.requiredClaims ?? [...manifestTool.requiredClaims],
      requiredScopes: policy.requiredScopes ?? [...manifestTool.requiredScopes],
      toolName: entry.toolName,
      values: { ...entry.values },
    });
  });

  // Exact coverage: configuration alone cannot rename, remove or add a tool.
  for (const name of manifestTools.keys()) {
    if (!seen.has(name)) {
      diag(diagnostics, 'missing_binding', `snapshot.bindings.${name}`, `missing binding for "${name}"`);
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const config: CompiledToolConfiguration = {
    compatibilityDigest,
    manifestDigest,
    providerId: manifest.providerId,
    revision: snapshot.revision as string,
    schemaVersion: TOOL_CONFIGURATION_SCHEMA_VERSION,
    tools: [...compiled].sort((a, b) => (a.toolName < b.toolName ? -1 : a.toolName > b.toolName ? 1 : 0)),
  };
  return { ok: true, config: deepFreeze(config) };
}

