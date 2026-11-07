import { GitAppError, type GitAppEnvelopeStore } from '@sentropic/cluster-mesh';
import type { Pool } from 'pg';

import { pool as defaultPool } from '../../db/client';

/**
 * A-LIVE W1 (M2-S, G0 v3 §2.7) — durable Postgres custody envelopes for
 * SG0-app enrollments on the control stream.
 *
 * One row per enrollment reference gives the unique, scope-bound reference
 * the contract names. The envelope column stores only cluster-mesh
 * ciphertext: this module never sees a key or plaintext. A serializable
 * transaction with `SELECT ... FOR UPDATE` orders every same-ref action
 * deterministically; unlike a retrying store, a lost transaction surfaces
 * as a sanitized `capability_unavailable` refusal instead of silently
 * running a provider-visible action a second time (mint/revocation calls
 * must never repeat). The empty string is the row-exists-but-unenrolled
 * sentinel the `GitAppEnvelopeStore` contract needs to tell a first create
 * from a committed enrollment.
 */
export const INSTALLATION_REF_PATTERN = /^enroll_[0-9a-fA-F-]{36}$/;
const TARGET_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export interface GitHubAppEnvelopeStore extends GitAppEnvelopeStore {
  /** Durable ref→target-key mapping written once by the host after `begin`. */
  record(ref: string, targetKey: string): Promise<void>;
  /** Resolves a ref route to its enrolled registry target key, or null. */
  lookup(ref: string): Promise<string | null>;
}

type PoolLike = Pick<Pool, 'connect' | 'query'>;

const assertRef = (ref: string): void => {
  // Refs reach SQL only as bind values; the pattern still keeps guesses,
  // tombstone scans and future ref formats apart from real enrollments.
  if (!INSTALLATION_REF_PATTERN.test(ref)) throw new GitAppError('invalid_request');
};

export const createPostgresGitHubAppEnvelopeStore = (
  options: { pool?: PoolLike } = {},
): GitHubAppEnvelopeStore => {
  const pg: PoolLike = options.pool ?? defaultPool;

  const transaction = async <T>(
    ref: string,
    action: (sealed: string | null) => Promise<{ sealed: string; result: T }>,
  ): Promise<T> => {
    assertRef(ref);
    const client = await pg.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      // Ensure the row exists without overwriting a committed envelope: the
      // sentinel '' marks a fresh row, a non-empty value is committed state.
      await client.query(
        'INSERT INTO control.github_app_enrollments (installation_ref, envelope) VALUES ($1, \'\') ON CONFLICT (installation_ref) DO NOTHING',
        [ref],
      );
      const selected = await client.query(
        'SELECT envelope FROM control.github_app_enrollments WHERE installation_ref = $1 FOR UPDATE',
        [ref],
      );
      const sealedRow = selected.rows[0]?.envelope;
      const existing = typeof sealedRow === 'string' && sealedRow.length > 0 ? sealedRow : null;
      const outcome = await action(existing);
      if (typeof outcome?.sealed !== 'string' || !outcome.sealed.length) {
        throw new GitAppError('invalid_request');
      }
      await client.query(
        'UPDATE control.github_app_enrollments SET envelope = $2, updated_at = now() WHERE installation_ref = $1',
        [ref, outcome.sealed],
      );
      await client.query('COMMIT');
      return outcome.result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof GitAppError) throw error;
      // Sanitized refusal: no driver text, envelope bytes or provider detail.
      throw new GitAppError('capability_unavailable');
    } finally {
      client.release();
    }
  };

  return {
    transaction,
    record: async (ref, targetKey) => {
      assertRef(ref);
      if (!TARGET_KEY_PATTERN.test(targetKey)) throw new GitAppError('invalid_request');
      await pg.query(
        'INSERT INTO control.github_app_enrollments (installation_ref, target_key, envelope) VALUES ($1, $2, \'\') ' +
        'ON CONFLICT (installation_ref) DO UPDATE SET target_key = EXCLUDED.target_key',
        [ref, targetKey],
      );
    },
    lookup: async (ref) => {
      assertRef(ref);
      const selected = await pg.query(
        'SELECT target_key FROM control.github_app_enrollments WHERE installation_ref = $1',
        [ref],
      );
      const targetKey = selected.rows[0]?.target_key;
      return typeof targetKey === 'string' && targetKey.length > 0 ? targetKey : null;
    },
  };
};
