/**
 * MCP-L5 Lot 1 — frozen production memory contracts (Sentropic side).
 *
 * Transcribed from frozen SPEC-memory-mcp v3.1
 * (SHA-256 f90c927964b44fdf6ad712eee9b894762250239384643a3790931c142d3aeeca)
 * and the accepted L0 bundle at engram 60a8bfa828b5eabd360232ea5865391c23f99f48.
 * L4-consumed types and schemas only: tool names, closed envelopes, the
 * M5 mutation preimage and digest profile, confirmation schemas and the
 * M6 public error union. No runtime import of a cluster-mesh source path.
 *
 * This module is pure (type declarations plus dependency-free validators),
 * except `node:crypto` use in sibling `mutation-guard.ts`. It never imports
 * mock, testing, experimental or store helpers.
 */

import type { CapabilityTool } from '../manifest.js';
import { TOOL_SCHEMAS } from './tool-schemas.js';

// ---------------------------------------------------------------------------
// Frozen identities
// ---------------------------------------------------------------------------

/** Memory wire profile identifier (M2/M7). */
export const MEMORY_WIRE_PROFILE_ID = 'sentropic.engram.memory-wire/v1';
/** Memory tool-schema profile identifier (M2/M7). */
export const MEMORY_TOOLS_PROFILE_ID = 'sentropic.engram.memory-tools/2020-12-v1';
/** Memory mutation digest profile identifier (M5). */
export const MEMORY_MUTATION_DIGEST_PROFILE_ID = 'sentropic.engram.memory-mutation/v1';
/** Provider identifier for the Engram memory provider. */
export const MEMORY_PROVIDER_ID = 'sentropic.engram.memory' as const;
/** Connector identifier for the Engram memory connector. */
export const MEMORY_CONNECTOR_ID = 'engram-memory' as const;
/** Provider behavioral-contract version consumed by L4. */
export const MEMORY_PROVIDER_CONTRACT_VERSION = '1.0.0';
/** Structured MCP payload schema version. */
export const MEMORY_PAYLOAD_SCHEMA_VERSION = 1;

/** The six exact M1 agent-facing tool names. */
export const MEMORY_TOOL_NAMES = [
  'engram_memory_search',
  'engram_memory_get',
  'engram_memory_capture',
  'engram_memory_request_admission',
  'engram_memory_withdraw',
  'engram_memory_forget',
] as const;

export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number];

/** The four mutating tools (M5 durable operations). */
export const MUTATING_MEMORY_TOOL_NAMES = [
  'engram_memory_capture',
  'engram_memory_request_admission',
  'engram_memory_withdraw',
  'engram_memory_forget',
] as const;

export type MutatingMemoryToolName = (typeof MUTATING_MEMORY_TOOL_NAMES)[number];

export function isMemoryToolName(value: unknown): value is MemoryToolName {
  return (
    typeof value === 'string' &&
    (MEMORY_TOOL_NAMES as readonly string[]).includes(value)
  );
}

export function isMutatingMemoryToolName(value: unknown): value is MutatingMemoryToolName {
  return (
    typeof value === 'string' &&
    (MUTATING_MEMORY_TOOL_NAMES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// String primitives (M2 byte budgets)
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** UTF-8 byte length of a string. */
export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

/** NFC check: content is preserved, never silently rewritten. */
export function isNfc(value: string): boolean {
  return value.normalize('NFC') === value;
}

/** Well-formed Unicode (no lone surrogates). */
export function isWellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** OpaqueRef: NFC string, 1-512 UTF-8 bytes (M2). */
export function isValidOpaqueRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const bytes = utf8ByteLength(value);
  return bytes >= 1 && bytes <= 512 && isNfc(value) && isWellFormed(value);
}

/** IdempotencyKey: NFC string, 16-256 UTF-8 bytes (M2). */
export function isValidIdempotencyKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const bytes = utf8ByteLength(value);
  return bytes >= 16 && bytes <= 256 && isNfc(value) && isWellFormed(value);
}

/** Digest: `sha256:` plus 64 lowercase hex digits (M2). */
export function isValidDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

/** Cursor: canonical unsigned-u64 decimal string without leading zeroes (M2). */
export function isValidCursor(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return false;
  try {
    return BigInt(value) <= 18446744073709551615n;
  } catch {
    return false;
  }
}

/** Instant: exactly 24 ASCII bytes, canonical YYYY-MM-DDTHH:mm:ss.sssZ (M2). */
export function isValidInstant(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  return new Date(time).toISOString() === value;
}

// ---------------------------------------------------------------------------
// Packet bounds (M2)
// ---------------------------------------------------------------------------

/** Default per-call packet budget in bytes. */
export const MEMORY_DEFAULT_MAX_PACKET_BYTES = 65536;
/** Minimum per-call packet budget in bytes. */
export const MEMORY_MIN_MAX_PACKET_BYTES = 4096;
/** Maximum per-call packet budget in bytes. */
export const MEMORY_MAX_MAX_PACKET_BYTES = 1048576;
/**
 * Combined escaped CallToolResult ceiling in UTF-8 bytes
 * (text copy escaping plus structured copy plus wrapper).
 */
export const MEMORY_COMBINED_RESULT_CEILING_BYTES = 2097152;

/** Confirmation TTL ceiling in seconds (M4). */
export const MEMORY_CONFIRMATION_TTL_SECONDS = 300;
/** Synchronous execution budget in seconds (M4). */
export const MEMORY_EXECUTION_BUDGET_SECONDS = 30;

// ---------------------------------------------------------------------------
// Result envelopes (M2)
// ---------------------------------------------------------------------------

export type MemoryToolSuccessV1<T> = {
  ok: true;
  output: {
    schema_version: 1;
    value: T;
  };
  auditId: string;
  redactionClass: 'high';
};

export type MemoryToolFailureV1 = {
  ok: false;
  auditId: string;
  redactionClass: 'high';
  error: {
    code: PublicMemoryErrorCode;
    message: string;
    retriable: boolean;
  };
};

export type MemoryToolEnvelopeV1<T> = MemoryToolSuccessV1<T> | MemoryToolFailureV1;

// ---------------------------------------------------------------------------
// Public error union (M6)
// ---------------------------------------------------------------------------

export type PublicMemoryErrorCode =
  | 'INVALID_SCHEMA'
  | 'INVALID_DIGEST'
  | 'UNAUTHORIZED'
  | 'AUTHORIZATION_EXPIRED'
  | 'AUTHORIZATION_REVOKED'
  | 'NOT_FOUND'
  | 'DIGEST_CONFLICT'
  | 'ILLEGAL_TRANSITION'
  | 'ALREADY_TERMINAL'
  | 'POLICY_UNAVAILABLE'
  | 'POLICY_STALE'
  | 'STALE_PAGE'
  | 'RANKING_UNAVAILABLE'
  | 'PROJECTION_STALE'
  | 'PROJECTION_OVERSIZED'
  | 'REGISTRY_VERSION_UNAVAILABLE'
  | 'CAPABILITY_UNAVAILABLE'
  | 'STORE_UNAVAILABLE'
  | 'FENCE_LOST'
  | 'CURSOR_GAP'
  | 'JOURNAL_CORRUPT'
  | 'BLOB_MISSING'
  | 'BACKUP_INVALID'
  | 'RESTORE_REFUSED'
  | 'MIGRATION_LEDGER_INVALID'
  | 'DEADLINE_EXCEEDED'
  | 'CANCELLED'
  | 'RESULT_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'MUTATION_OUTCOME_UNKNOWN'
  | 'gate_failed';

const PUBLIC_MEMORY_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  'INVALID_SCHEMA', 'INVALID_DIGEST', 'UNAUTHORIZED', 'AUTHORIZATION_EXPIRED',
  'AUTHORIZATION_REVOKED', 'NOT_FOUND', 'DIGEST_CONFLICT', 'ILLEGAL_TRANSITION',
  'ALREADY_TERMINAL', 'POLICY_UNAVAILABLE', 'POLICY_STALE', 'STALE_PAGE',
  'RANKING_UNAVAILABLE', 'PROJECTION_STALE', 'PROJECTION_OVERSIZED',
  'REGISTRY_VERSION_UNAVAILABLE', 'CAPABILITY_UNAVAILABLE', 'STORE_UNAVAILABLE',
  'FENCE_LOST', 'CURSOR_GAP', 'JOURNAL_CORRUPT', 'BLOB_MISSING', 'BACKUP_INVALID',
  'RESTORE_REFUSED', 'MIGRATION_LEDGER_INVALID', 'DEADLINE_EXCEEDED', 'CANCELLED',
  'RESULT_TOO_LARGE', 'RATE_LIMITED', 'MUTATION_OUTCOME_UNKNOWN', 'gate_failed',
]);

export function isPublicMemoryErrorCode(value: unknown): value is PublicMemoryErrorCode {
  return typeof value === 'string' && PUBLIC_MEMORY_ERROR_CODES.has(value);
}

/** Pre-dispatch protocol error code for missing or untrusted audit (M2/M6). */
export const TRUSTED_CONTEXT_PROTOCOL_ERROR_CODE = -32603;
/** Constant protocol message for missing or untrusted invocation context. */
export const TRUSTED_CONTEXT_UNAVAILABLE_MESSAGE = 'Trusted invocation context unavailable';
/** Forbidden synthetic audit fallback (M2). */
export const FORBIDDEN_SYNTHETIC_AUDIT_ID = 'audit_mcp_l0_default';

// ---------------------------------------------------------------------------
// Mutation preimage and effective inputs (M5)
// ---------------------------------------------------------------------------

export type MemoryMutationTargetV1 =
  | { kind: 'capture_source'; source_ref: string; sequence: string }
  | { kind: 'candidate'; candidate_id: string }
  | { kind: 'record'; record_id: string };

export type EffectiveMemoryMutationInputV1 =
  | {
      tool_name: 'engram_memory_capture';
      payload: Record<string, unknown>;
      evidence: Record<string, unknown>;
      capture_policy_version: string;
    }
  | {
      tool_name: 'engram_memory_request_admission';
      candidate_id: string;
      admission_policy_version: string;
    }
  | {
      tool_name: 'engram_memory_withdraw';
      candidate_id: string;
      reason_ref: string;
      event_id: string;
      event_anchor: Record<string, unknown>;
    }
  | {
      tool_name: 'engram_memory_forget';
      record_id: string;
      reason_ref: string;
      event_id: string;
      event_anchor: Record<string, unknown>;
    };

export type MemoryMutationPolicyVersionsV1 =
  | { tool_name: 'engram_memory_capture'; capture_policy_version: string }
  | { tool_name: 'engram_memory_request_admission'; admission_policy_version: string }
  | { tool_name: 'engram_memory_withdraw' }
  | { tool_name: 'engram_memory_forget' };

export type MemoryMutationPreimageV1 = {
  profile: 'sentropic.engram.memory-mutation/v1';
  reservation_ref: string;
  provider_id: 'sentropic.engram.memory';
  provider_contract_version: '1.0.0';
  principal_namespace: string;
  principal_id: string;
  tenant_id: string;
  store_id: string;
  connector_id: 'engram-memory';
  connector_instance_ref: string;
  scope_ref: string;
  tool_name: MutatingMemoryToolName;
  idempotency_key: string;
  target: MemoryMutationTargetV1;
  effective_input: EffectiveMemoryMutationInputV1;
};

/** Stable reservation lookup key: principal-scoped 9-tuple (M5). */
export type MemoryReservationLookupKeyV1 = {
  principal_namespace: string;
  principal_id: string;
  tenant_id: string;
  store_id: string;
  provider_id: 'sentropic.engram.memory';
  connector_id: 'engram-memory';
  connector_instance_ref: string;
  scope_ref: string;
  idempotency_key: string;
};

// ---------------------------------------------------------------------------
// Confirmation schemas (M7 exact literals)
// ---------------------------------------------------------------------------

export const MemoryConfirmationRequestV1Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['capability', 'target_ref', 'operation_digest'],
  properties: {
    capability: {
      enum: ['engram_memory_withdraw', 'engram_memory_forget'],
    },
    target_ref: { type: 'string', minLength: 1, maxLength: 512 },
    operation_digest: {
      type: 'string',
      pattern: '^sha256:[0-9a-f]{64}$',
    },
  },
} as const;

export const MemoryConfirmationResponseV1Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['approved'],
  properties: { approved: { type: 'boolean' } },
} as const;

// ---------------------------------------------------------------------------
// Six normative tool descriptors (M7 exact per-tool gates)
// ---------------------------------------------------------------------------

function memoryTool(
  name: MemoryToolName,
  description: string,
  mutability: CapabilityTool['mutability'],
  category: 'read' | 'write',
  mutatesExternalSystem: boolean,
  idempotencyRequired: boolean,
  requiresHumanConfirmation: boolean,
): CapabilityTool {
  return {
    kind: 'tool',
    name,
    description,
    requiredScopes: ['mcp:tools:invoke'],
    requiredClaims: ['sub', 'tid'],
    inputSchema: TOOL_SCHEMAS[name].inputSchema,
    outputSchema: TOOL_SCHEMAS[name].outputSchema,
    redactionClass: 'high',
    mutability,
    category,
    mutatesExternalSystem,
    idempotency: idempotencyRequired
      ? { required: true, scope: 'principal' }
      : { required: false },
    gates: {
      requiresElicitation: false,
      requiresHumanConfirmation,
      requiresPrincipalGate: false,
      requiresPolicy: true,
    },
  };
}

/**
 * The six frozen M7 tool descriptors. Schema identities are bound by the
 * L0-frozen M2 assets; this table freezes names, scopes, claims, mutability,
 * idempotency scope and gates consumed by L5 dispatch.
 */
export const MEMORY_TOOLS: readonly CapabilityTool[] = [
  memoryTool('engram_memory_search', 'Search authorized current memory with citations and ranking receipts.', 'read-only', 'read', false, false, false),
  memoryTool('engram_memory_get', 'Read one authorized currently eligible canonical memory record.', 'read-only', 'read', false, false, false),
  memoryTool('engram_memory_capture', 'Durably submit cited material as an encrypted pending candidate.', 'append', 'write', true, true, false),
  memoryTool('engram_memory_request_admission', 'Request the configured admission policy decision for a pending candidate.', 'state-transition', 'write', true, true, false),
  memoryTool('engram_memory_withdraw', 'Withdraw an authorized pending candidate with confirmed key-destruction status.', 'state-transition', 'write', true, true, true),
  memoryTool('engram_memory_forget', 'Forget an authorized admitted memory with accurate cleanup status.', 'state-transition', 'write', true, true, true),
];

export function findMemoryTool(name: string): CapabilityTool | undefined {
  return MEMORY_TOOLS.find((tool) => tool.name === name);
}
