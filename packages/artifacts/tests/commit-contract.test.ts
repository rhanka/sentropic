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
  ORDINARY_FAILURE_CATEGORIES,
  ORDINARY_FAILURE_PROJECTIONS,
  OUTCOME_SUCCESS_FIELDS,
} from '../l0-freeze/failure-contract.js';
import type { OrdinaryFailure } from '../l0-freeze/failure-contract.js';
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

  it('should know the ordinary domain failure categories', () => {
    expect([...ORDINARY_FAILURE_CATEGORIES]).toEqual([
      'invalid_request', 'not_found', 'gone', 'unprocessable', 'verification_failed',
    ]);
  });

  it('should project ordinary failures without ledger entries', () => {
    expect(ORDINARY_FAILURE_PROJECTIONS.map((entry) => [
      entry.category, entry.httpStatus, entry.publicCode,
    ])).toEqual([
      ['invalid_request', 400, 'invalid_request'],
      ['not_found', 404, 'not_found'],
      ['gone', 410, 'gone'],
      ['unprocessable', 422, 'unprocessable'],
      ['verification_failed', 422, 'verification_failed'],
    ]);
    for (const entry of ORDINARY_FAILURE_PROJECTIONS) {
      expect(entry.retriable).toBe(false);
      expect(entry.phase).toBe('entry');
      expect(entry.commitState).toBe('not_committed');
      expect('radarLedgerReason' in entry).toBe(false);
    }
  });

  it('should keep a typed ordinary 400 failure with its private cause', () => {
    const cause = new Error('unknown field: owner');
    const failure: OrdinaryFailure = {
      kind: 'ordinary',
      category: 'invalid_request',
      httpStatus: 400,
      publicCode: 'invalid_request',
      retriable: false,
      invocationId: 'inv-1',
      operation: 'publish',
      phase: 'entry',
      commitState: 'not_committed',
      cause,
    };
    expect(failure.cause).toBe(cause);
    expect(failure.commitState).toBe('not_committed');
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

  it('should direct the release train at the r2 integration branch', () => {
    const docDir = dirname(fileURLToPath(import.meta.url));
    const doc = readFileSync(join(docDir, '..', 'docs', 'migration-inventory-l0.md'), 'utf8');
    expect(doc).toContain('feat/immo-861-integration');
    expect(doc).not.toContain('feat/artifacts-861-integration');
    expect(doc).toContain('never main');
    expect(doc).toContain('no cherry-picks');
    expect(doc).toContain('0.2.0-dev');
    expect(doc).not.toContain('0.2.0-rc.1');
    expect(doc).toContain('9b0f7e0d374e47b10fb855c13edd832be480f7faf148f1dd94569265300228a2');
    expect(doc).toContain('e5e3b4d15382713182d50eaed504ed1a3574c1b577d8684d6856f5c8f1c8e97e');
    expect(doc).toContain('fc5709f1b335de146a35252a7f5dad3f6c70caff741ec383f56110f0d888b4e6');
    expect(doc).toContain('77fcfe4baf66a5652e2a79bdfb8b12271c38c84d23069ac3c84171be543da5d3');
    expect(doc).toContain('982e8e435ba954bcc4cec8905b7c98e5d011d636512de1fbe94492d6605158cf');
    expect(doc).toContain('383192e36780f363ed46568d1bab77ee81e91e9a763afd117d6ae53521c08bd7');
  });
});
