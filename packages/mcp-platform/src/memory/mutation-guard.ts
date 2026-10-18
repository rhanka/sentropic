/**
 * MCP-L5 Lot 1 — mutation digest and reservation guard (M5).
 *
 * Closed validation of `MemoryMutationPreimageV1` and the four
 * `EffectiveMemoryMutationInputV1` arms, the
 * `sentropic.engram.memory-mutation/v1` digest profile
 * (`sha256:` plus `SHA256(UTF8(RFC8785(preimage)))`), the principal-scoped
 * reservation lookup key and same-key conflict detection.
 *
 * Version omission refuses before hashing; retries reuse recorded versions.
 * Tool, target and digest are immutable binding values, never lookup-key
 * components: the same key with different normalized content, target or
 * tool yields `DIGEST_CONFLICT` after current authorization.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../tool-configuration.js';
import {
  MEMORY_MUTATION_DIGEST_PROFILE_ID,
  MEMORY_PROVIDER_ID,
  MEMORY_CONNECTOR_ID,
  MEMORY_PROVIDER_CONTRACT_VERSION,
  isMutatingMemoryToolName,
  isValidIdempotencyKey,
  isValidOpaqueRef,
  type EffectiveMemoryMutationInputV1,
  type MemoryMutationPolicyVersionsV1,
  type MemoryMutationPreimageV1,
  type MemoryMutationTargetV1,
  type MemoryReservationLookupKeyV1,
  type MutatingMemoryToolName,
} from './contracts.js';

export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.getOwnPropertyNames(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

const CAPTURE_INPUT_KEYS = ['tool_name', 'payload', 'evidence', 'capture_policy_version'] as const;
const ADMISSION_INPUT_KEYS = ['tool_name', 'candidate_id', 'admission_policy_version'] as const;
const WITHDRAW_INPUT_KEYS = ['tool_name', 'candidate_id', 'reason_ref', 'event_id', 'event_anchor'] as const;
const FORGET_INPUT_KEYS = ['tool_name', 'record_id', 'reason_ref', 'event_id', 'event_anchor'] as const;

function checkPolicyVersion(value: unknown, field: string, failures: string[]): void {
  if (!isValidOpaqueRef(value)) {
    failures.push(`${field}: policy version must be a nonempty NFC opaque reference`);
  }
}

/**
 * Validate one closed effective-input arm. Every listed property is
 * required, unknown properties are rejected recursively and null is
 * invalid. Returns failure strings, empty when valid.
 */
export function validateEffectiveInput(input: unknown): string[] {
  const failures: string[] = [];
  if (!isPlainRecord(input)) return ['effective_input: must be a plain object'];
  const toolName = (input as Record<string, unknown>)['tool_name'];
  if (!isMutatingMemoryToolName(toolName)) {
    return ['effective_input.tool_name: unknown mutating tool'];
  }
  switch (toolName) {
    case 'engram_memory_capture': {
      if (!hasOnlyKeys(input, CAPTURE_INPUT_KEYS)) {
        failures.push('effective_input: capture arm must carry exactly tool_name, payload, evidence, capture_policy_version');
        break;
      }
      const rec = input as Record<string, unknown>;
      if (!isPlainRecord(rec['payload'])) failures.push('effective_input.payload: must be a plain object');
      if (!isPlainRecord(rec['evidence'])) failures.push('effective_input.evidence: must be a plain object');
      checkPolicyVersion(rec['capture_policy_version'], 'effective_input.capture_policy_version', failures);
      break;
    }
    case 'engram_memory_request_admission': {
      if (!hasOnlyKeys(input, ADMISSION_INPUT_KEYS)) {
        failures.push('effective_input: admission arm must carry exactly tool_name, candidate_id, admission_policy_version');
        break;
      }
      const rec = input as Record<string, unknown>;
      if (!isValidOpaqueRef(rec['candidate_id'])) failures.push('effective_input.candidate_id: invalid OpaqueRef');
      checkPolicyVersion(rec['admission_policy_version'], 'effective_input.admission_policy_version', failures);
      break;
    }
    case 'engram_memory_withdraw': {
      if (!hasOnlyKeys(input, WITHDRAW_INPUT_KEYS)) {
        failures.push('effective_input: withdraw arm must carry exactly tool_name, candidate_id, reason_ref, event_id, event_anchor');
        break;
      }
      validateLifecycleArm(input as Record<string, unknown>, 'candidate_id', failures);
      break;
    }
    case 'engram_memory_forget': {
      if (!hasOnlyKeys(input, FORGET_INPUT_KEYS)) {
        failures.push('effective_input: forget arm must carry exactly tool_name, record_id, reason_ref, event_id, event_anchor');
        break;
      }
      validateLifecycleArm(input as Record<string, unknown>, 'record_id', failures);
      break;
    }
  }
  return failures;
}

function validateLifecycleArm(
  rec: Record<string, unknown>,
  idField: 'candidate_id' | 'record_id',
  failures: string[],
): void {
  if (!isValidOpaqueRef(rec[idField])) failures.push(`effective_input.${idField}: invalid OpaqueRef`);
  if (!isValidOpaqueRef(rec['reason_ref'])) failures.push('effective_input.reason_ref: invalid OpaqueRef');
  if (!isValidOpaqueRef(rec['event_id'])) failures.push('effective_input.event_id: invalid OpaqueRef');
  const anchor = rec['event_anchor'];
  if (!isPlainRecord(anchor)) {
    failures.push('effective_input.event_anchor: must be a plain object');
    return;
  }
  if (!hasOnlyKeys(anchor, ['occurred_at', 'kind_ref', 'provenance_ref', 'provenance_digest'] as const)) {
    failures.push('effective_input.event_anchor: must carry exactly occurred_at, kind_ref, provenance_ref, provenance_digest');
    return;
  }
  if (!isValidOpaqueRef(anchor['kind_ref'])) failures.push('effective_input.event_anchor.kind_ref: invalid OpaqueRef');
  if (!isValidOpaqueRef(anchor['provenance_ref'])) failures.push('effective_input.event_anchor.provenance_ref: invalid OpaqueRef');
  const digest = anchor['provenance_digest'];
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    failures.push('effective_input.event_anchor.provenance_digest: invalid digest');
  }
}

/** Validate a mutation target value. */
export function validateMutationTarget(target: unknown): string[] {
  if (!isPlainRecord(target)) return ['target: must be a plain object'];
  const kind = (target as Record<string, unknown>)['kind'];
  if (kind === 'capture_source') {
    if (!hasOnlyKeys(target, ['kind', 'source_ref', 'sequence'])) {
      return ['target: capture_source must carry exactly kind, source_ref, sequence'];
    }
    const rec = target as Record<string, unknown>;
    if (!isValidOpaqueRef(rec['source_ref'])) return ['target.source_ref: invalid OpaqueRef'];
    if (typeof rec['sequence'] !== 'string' || !/^(0|[1-9][0-9]*)$/.test(rec['sequence'])) {
      return ['target.sequence: invalid cursor'];
    }
    return [];
  }
  if (kind === 'candidate') {
    if (!hasOnlyKeys(target, ['kind', 'candidate_id'])) return ['target: candidate must carry exactly kind, candidate_id'];
    if (!isValidOpaqueRef((target as Record<string, unknown>)['candidate_id'])) {
      return ['target.candidate_id: invalid OpaqueRef'];
    }
    return [];
  }
  if (kind === 'record') {
    if (!hasOnlyKeys(target, ['kind', 'record_id'])) return ['target: record must carry exactly kind, record_id'];
    if (!isValidOpaqueRef((target as Record<string, unknown>)['record_id'])) {
      return ['target.record_id: invalid OpaqueRef'];
    }
    return [];
  }
  return ['target.kind: unknown target kind'];
}

const PREIMAGE_KEYS = [
  'profile', 'reservation_ref', 'provider_id', 'provider_contract_version',
  'principal_namespace', 'principal_id', 'tenant_id', 'store_id', 'connector_id',
  'connector_instance_ref', 'scope_ref', 'tool_name', 'idempotency_key',
  'target', 'effective_input',
] as const;

/**
 * Validate a complete mutation preimage, including outer/inner tool_name
 * identity and tool/target/input consistency. Returns failures, empty when
 * valid.
 */
export function validateMutationPreimage(preimage: unknown): string[] {
  const failures: string[] = [];
  if (!isPlainRecord(preimage)) return ['preimage: must be a plain object'];
  if (!hasOnlyKeys(preimage, PREIMAGE_KEYS)) {
    return ['preimage: must carry exactly the fifteen closed preimage members'];
  }
  const rec = preimage as Record<string, unknown>;
  if (rec['profile'] !== MEMORY_MUTATION_DIGEST_PROFILE_ID) failures.push('preimage.profile: unknown digest profile');
  if (rec['provider_id'] !== MEMORY_PROVIDER_ID) failures.push('preimage.provider_id: unknown provider');
  if (rec['provider_contract_version'] !== MEMORY_PROVIDER_CONTRACT_VERSION) {
    failures.push('preimage.provider_contract_version: unknown contract version');
  }
  if (rec['connector_id'] !== MEMORY_CONNECTOR_ID) failures.push('preimage.connector_id: unknown connector');
  if (!isValidOpaqueRef(rec['reservation_ref'])) failures.push('preimage.reservation_ref: invalid OpaqueRef');
  for (const field of ['principal_namespace', 'principal_id', 'tenant_id', 'store_id', 'connector_instance_ref', 'scope_ref'] as const) {
    if (!isValidOpaqueRef(rec[field])) failures.push(`preimage.${field}: invalid OpaqueRef`);
  }
  if (!isValidIdempotencyKey(rec['idempotency_key'])) failures.push('preimage.idempotency_key: invalid IdempotencyKey');
  const toolName = rec['tool_name'];
  if (!isMutatingMemoryToolName(toolName)) {
    failures.push('preimage.tool_name: unknown mutating tool');
    return failures;
  }
  failures.push(...validateMutationTarget(rec['target']));
  failures.push(...validateEffectiveInput(rec['effective_input']));
  if (failures.length > 0) return failures;
  const effective = rec['effective_input'] as EffectiveMemoryMutationInputV1;
  if (effective.tool_name !== toolName) {
    failures.push('preimage: outer and inner tool_name must be identical');
    return failures;
  }
  const target = rec['target'] as MemoryMutationTargetV1;
  const consistent =
    (toolName === 'engram_memory_capture' && target.kind === 'capture_source') ||
    ((toolName === 'engram_memory_request_admission' || toolName === 'engram_memory_withdraw') &&
      target.kind === 'candidate') ||
    (toolName === 'engram_memory_forget' && target.kind === 'record');
  if (!consistent) failures.push('preimage: impossible tool/target combination');
  if (toolName === 'engram_memory_request_admission' || toolName === 'engram_memory_withdraw') {
    const id = toolName === 'engram_memory_request_admission'
      ? (effective as { candidate_id: string }).candidate_id
      : (effective as { candidate_id: string }).candidate_id;
    if (target.kind === 'candidate' && id !== target.candidate_id) {
      failures.push('preimage: candidate_id must match the candidate target');
    }
  }
  if (toolName === 'engram_memory_forget') {
    const recordId = (effective as { record_id: string }).record_id;
    if (target.kind === 'record' && recordId !== target.record_id) {
      failures.push('preimage: record_id must match the record target');
    }
  }
  return failures;
}

/**
 * Seal a validated preimage to its operation digest:
 * `sha256:` plus `SHA256(UTF8(RFC8785(preimage)))`. Throws on validation
 * failure; version omission refuses before hashing.
 */
export function computeMutationDigest(preimage: MemoryMutationPreimageV1): string {
  const failures = validateMutationPreimage(preimage);
  if (failures.length > 0) {
    throw new Error(`MemoryMutationPreimageV1 invalid: ${failures.join('; ')}`);
  }
  return `sha256:${sha256HexBytes(new TextEncoder().encode(canonicalJson(preimage)))}`;
}

/** Derive the stable principal-scoped reservation lookup key (M5). */
export function reservationLookupKey(
  preimage: MemoryMutationPreimageV1,
): MemoryReservationLookupKeyV1 {
  return {
    principal_namespace: preimage.principal_namespace,
    principal_id: preimage.principal_id,
    tenant_id: preimage.tenant_id,
    store_id: preimage.store_id,
    provider_id: preimage.provider_id,
    connector_id: preimage.connector_id,
    connector_instance_ref: preimage.connector_instance_ref,
    scope_ref: preimage.scope_ref,
    idempotency_key: preimage.idempotency_key,
  };
}

export type SameKeyOutcome =
  | { decision: 'reuse'; digest: string }
  | { decision: 'DIGEST_CONFLICT' };

/**
 * Compare an incoming sealed request against the stored binding located
 * under the same lookup key. Same tool, target and digest reuses the
 * original reservation; any difference conflicts with zero second effect.
 * Current authorization happens before this comparison, in the caller.
 */
export function checkSameKeyBinding(
  stored: { toolName: MutatingMemoryToolName; target: MemoryMutationTargetV1; digest: string },
  incoming: { toolName: MutatingMemoryToolName; target: MemoryMutationTargetV1; digest: string },
): SameKeyOutcome {
  if (
    stored.toolName === incoming.toolName &&
    JSON.stringify(stored.target) === JSON.stringify(incoming.target) &&
    stored.digest === incoming.digest
  ) {
    return { decision: 'reuse', digest: stored.digest };
  }
  return { decision: 'DIGEST_CONFLICT' };
}

/**
 * Validate that a persisted `policy_versions` record is the exact
 * projection of the sealed effective input. Tag-only withdraw/forget
 * projections must not fabricate a capture/admission version.
 */
export function validatePolicyVersionsProjection(
  effectiveInput: EffectiveMemoryMutationInputV1,
  projection: MemoryMutationPolicyVersionsV1,
): string[] {
  if (effectiveInput.tool_name !== projection.tool_name) {
    return ['policy_versions.tool_name: must match the effective input tool'];
  }
  switch (effectiveInput.tool_name) {
    case 'engram_memory_capture': {
      const expected = effectiveInput.capture_policy_version;
      const actual = (projection as { capture_policy_version?: unknown }).capture_policy_version;
      return actual === expected
        ? []
        : ['policy_versions.capture_policy_version: must equal the sealed effective version'];
    }
    case 'engram_memory_request_admission': {
      const expected = effectiveInput.admission_policy_version;
      const actual = (projection as { admission_policy_version?: unknown }).admission_policy_version;
      return actual === expected
        ? []
        : ['policy_versions.admission_policy_version: must equal the sealed effective version'];
    }
    default:
      return hasOnlyKeys(projection as unknown as Record<string, unknown>, ['tool_name'])
        ? []
        : ['policy_versions: tag-only projection must not fabricate a version'];
  }
}
