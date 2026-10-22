/**
 * L0 — commit-contract vectors (immo #861, asks 2 and 3 shape only).
 *
 * Frozen failure-projection and finalization-order vectors. Pure unit
 * vectors: no DB, no S3, no app.handle, no mocked provider.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMIT_STATES,
  FINALIZATION_PHASES,
  REFUSAL_RESIDUE_FORBIDDEN,
} from '../l0-freeze/commit-contract.js';
import {
  FAILURE_CATEGORIES,
  FAILURE_PROJECTIONS,
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

  it('should know the four internal failure categories', () => {
    expect([...FAILURE_CATEGORIES]).toEqual([
      'provider_unavailable', 'conflict', 'unauthorized_at_commit', 'provider_error',
    ]);
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

  it('should distinguish the three commit states', () => {
    expect([...COMMIT_STATES]).toEqual(['not_committed', 'committed', 'unknown']);
  });
});
