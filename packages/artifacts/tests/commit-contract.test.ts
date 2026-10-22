/**
 * L0 — commit-contract vectors (immo #861, asks 2 and 3 shape only).
 *
 * Frozen failure-projection and finalization-order vectors. Pure unit
 * vectors: no DB, no S3, no app.handle, no mocked provider.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMMIT_BARRIER_POINTS,
  COMMIT_PROTOCOL_VERSION,
  COMMIT_STATES,
  FINALIZATION_PHASES,
  HTTP_APP_REQUIRED_DEPS,
  PARTICIPANT_LOCK_ORDER,
  REFUSAL_RESIDUE_FORBIDDEN,
} from '../l0-freeze/commit-contract.js';
import {
  FAILURE_CATEGORIES,
  FAILURE_PROJECTIONS,
  OUTCOME_SUCCESS_FIELDS,
} from '../l0-freeze/failure-contract.js';
import { COMMAND_CODEC_VERSION } from '../l0-freeze/command-identity-contract.js';

describe('commit contract', () => {
  it('should freeze the command-codec shape version', () => {
    expect(COMMAND_CODEC_VERSION).toBe('artifacts-command/v1');
  });

  it('should freeze the finalization phase order', () => {
    expect([...FINALIZATION_PHASES]).toEqual([
      'admit', 'prepare', 'lock', 'provision', 'guard', 'commit',
    ]);
  });

  it('should forbid every committed residue on refusal', () => {
    expect([...REFUSAL_RESIDUE_FORBIDDEN]).toEqual([
      'ready-release', 'pointer-advance', 'attached-provenance',
      'acl-binding-change', 'lifecycle-change', 'consumed-quota', 'replayable-success',
    ]);
  });

  it('should know the five internal failure categories', () => {
    expect([...FAILURE_CATEGORIES]).toEqual([
      'capability_unselected', 'provider_unavailable', 'conflict',
      'unauthorized_at_commit', 'provider_error',
    ]);
  });

  it('should reject unselected operations before dispatch with no ledger entry', () => {
    const projection = FAILURE_PROJECTIONS.find(
      (entry) => entry.category === 'capability_unselected',
    );
    expect(projection?.httpStatus).toBe(503);
    expect(projection?.publicCode).toBe('capability_unavailable');
    expect(projection?.retriable).toBe(false);
    expect(projection?.radarLedgerReason).toBeUndefined();
    expect(projection?.phase).toBe('selection');
    expect(projection?.commitState).toBe('not_committed');
  });

  it('should retry a guard authority outage with the same key', () => {
    const projection = FAILURE_PROJECTIONS.find(
      (entry) => entry.category === 'unauthorized_at_commit'
        && entry.variant === 'authority_unavailable',
    );
    expect(projection?.httpStatus).toBe(503);
    expect(projection?.publicCode).toBe('capability_unavailable');
    expect(projection?.radarLedgerReason).toBe('unauthorized_at_commit');
    expect(projection?.retriable).toBe(true);
  });

  it('should project S3 timeout and connection loss as unavailable', () => {
    const projection = FAILURE_PROJECTIONS.find(
      (entry) => entry.category === 'provider_unavailable',
    );
    expect(projection?.httpStatus).toBe(503);
    expect(projection?.publicCode).toBe('capability_unavailable');
    expect(projection?.retriable).toBe(true);
  });

  it('should keep genuine lock conflict non-retriable', () => {
    const projection = FAILURE_PROJECTIONS.find(
      (entry) => entry.category === 'conflict',
    );
    expect(projection?.httpStatus).toBe(409);
    expect(projection?.publicCode).toBe('conflict');
    expect(projection?.retriable).toBe(false);
  });

  it('should keep commit denial a sanitized refusal', () => {
    const projection = FAILURE_PROJECTIONS.find(
      (entry) => entry.category === 'unauthorized_at_commit',
    );
    expect(projection?.httpStatus).toBe(403);
    expect(projection?.retriable).toBe(false);
  });

  it('should project unclassified failures as internal errors', () => {
    const projection = FAILURE_PROJECTIONS.find(
      (entry) => entry.category === 'provider_error',
    );
    expect(projection?.httpStatus).toBe(500);
    expect(projection?.publicCode).toBe('internal_error');
    expect(projection?.retriable).toBe(false);
  });

  it('should carry invocation, commit-state and replay on success', () => {
    expect([...OUTCOME_SUCCESS_FIELDS]).toEqual([
      'ok', 'result', 'invocationId', 'commitState', 'replayed',
    ]);
  });

  it('should distinguish the three commit states', () => {
    expect([...COMMIT_STATES]).toEqual(['not_committed', 'committed', 'unknown']);
  });

  it('should version the commit coordinator protocol', () => {
    expect(COMMIT_PROTOCOL_VERSION).toBe('artifacts-commit/v1');
  });

  it('should freeze the nine section 3.2 barrier points', () => {
    expect([...COMMIT_BARRIER_POINTS]).toEqual([
      'before_connection_acquire',
      'before_key_lock',
      'before_blob_put',
      'after_blob_put_before_verify',
      'before_blob_readback',
      'before_finalization_row_lock',
      'after_finalization_locks_before_guard',
      'after_replay_lookup_before_guard',
      'before_commit',
    ]);
  });

  it('should freeze the A4 participant lock order', () => {
    expect([...PARTICIPANT_LOCK_ORDER]).toEqual([
      'binding-identity',
      'artifact-lifecycle',
      'acl',
      'current-pointer',
      'authority-revision',
      'quota',
      'blob-reference-deletion-claim',
    ]);
  });

  it('should require profile and coordinator with no legacy fallback', () => {
    expect([...HTTP_APP_REQUIRED_DEPS]).toEqual(['profile', 'coordinator']);
  });

  it('should map the normative CR-1 to CR-5 rules with declared deviations', () => {
    const docDir = dirname(fileURLToPath(import.meta.url));
    const doc = readFileSync(join(docDir, '..', 'docs', 'common-contract-map.md'), 'utf8');
    for (const rule of ['CR-1', 'CR-2', 'CR-3', 'CR-4', 'CR-5']) {
      expect(doc).toContain(rule);
    }
    expect(doc).toContain('refuse any common-rule admission or conformance claim');
    expect(doc).toContain('registers no common storage module');
  });

  it('should direct the release train at the integration branch', () => {
    const docDir = dirname(fileURLToPath(import.meta.url));
    const doc = readFileSync(join(docDir, '..', 'docs', 'migration-inventory-l0.md'), 'utf8');
    expect(doc).toContain('feat/artifacts-861-integration');
    expect(doc).toContain('no cherry-picks');
    expect(doc).toContain('0.2.0-dev');
    expect(doc).not.toContain('0.2.0-rc.1');
  });
});
