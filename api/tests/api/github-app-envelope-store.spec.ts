import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { GitAppError } from '@sentropic/cluster-mesh';

import { pool } from '../../src/db/client';
import {
  INSTALLATION_REF_PATTERN,
  createPostgresGitHubAppEnvelopeStore,
} from '../../src/services/cluster-mesh/github-app-envelope-store';

/**
 * A-LIVE W1 (M2-S) — durable Postgres custody envelopes for SG0-app enrollments.
 *
 * The cluster-mesh custodian already proves its cipher contract with package
 * tests. This suite proves the HOST half of `GitAppEnvelopeStore`: one durable
 * row per enrollment reference (G0 v3 §2.7 "distinct scope-bound enrollment
 * reference"), serializable cross-replica transactions without retry (a lost
 * transaction surfaces as a sanitized refusal, never as a second provider
 * call), committed state visible across store instances, and a durable
 * ref→target mapping that never clobbers a sealed envelope. The sentinel empty
 * envelope is the row-exists-but-unenrolled marker the transaction contract
 * needs to distinguish "first create" from "committed enrollment".
 */
describe('PostgresGitHubAppEnvelopeStore (A-LIVE W1)', () => {
  const touched: string[] = [];
  const freshRef = (): string => {
    const ref = `enroll_${randomUUID()}`;
    touched.push(ref);
    return ref;
  };

  afterEach(async () => {
    if (!touched.length) return;
    await pool.query('DELETE FROM control.github_app_enrollments WHERE installation_ref = ANY($1)', [touched]);
    touched.length = 0;
  });

  it('should mint refs matching the frozen installation-ref pattern', () => {
    expect(INSTALLATION_REF_PATTERN.test(`enroll_${randomUUID()}`)).toBe(true);
    expect(INSTALLATION_REF_PATTERN.test('enroll_not-a-ref')).toBe(false);
    expect(INSTALLATION_REF_PATTERN.test('../../etc')).toBe(false);
  });

  it('should commit a first-seen ref and expose it durably to later store instances', async () => {
    const ref = freshRef();
    const writer = createPostgresGitHubAppEnvelopeStore();
    const result = await writer.transaction(ref, async (existing) => {
      expect(existing).toBeNull();
      return { sealed: 'envelope-one', result: 'created' };
    });
    expect(result).toBe('created');
    // A fresh instance on the same table is the cross-replica shape: the
    // committed envelope must be readable without any in-process state.
    const reader = createPostgresGitHubAppEnvelopeStore();
    expect(await reader.transaction(ref, async (existing) => {
      expect(existing).toBe('envelope-one');
      return { sealed: existing!, result: 're-read' };
    })).toBe('re-read');
  });

  it('should refuse a second create, sanitize unexpected action failures, and remain unchanged', async () => {
    const ref = freshRef();
    const store = createPostgresGitHubAppEnvelopeStore();
    const create = (sealed: string | null) =>
      store.transaction(ref, async (existing) => {
        if (existing !== null) throw new GitAppError('invalid_request');
        return { sealed, result: 'created' };
      });
    await expect(create('envelope-one')).resolves.toBe('created');
    await expect(create('envelope-two')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(store.transaction(ref, async () => {
      throw new Error('unexpected action failure');
    })).rejects.toMatchObject({ code: 'capability_unavailable' });
    expect(await store.transaction(ref, async (existing) => {
      expect(existing).toBe('envelope-one');
      return { sealed: existing!, result: 'unchanged' };
    })).toBe('unchanged');
  });

  it('should serialize same-ref transactions: a second transaction waits and sees the first commit', async () => {
    const ref = freshRef();
    const store = createPostgresGitHubAppEnvelopeStore();
    let releaseFirst!: () => void;
    let enteredFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const entered = new Promise<void>((resolve) => { enteredFirst = resolve; });
    const first = store.transaction(ref, async (existing) => {
      expect(existing).toBeNull();
      enteredFirst();
      await gate;
      return { sealed: 'envelope-first', result: 'first' as const };
    });
    await entered;
    const second = store.transaction(ref, async (existing) => {
      // Runs strictly after the first commit: the row lock orders the two.
      expect(existing).toBe('envelope-first');
      return { sealed: 'envelope-second', result: 'second' as const };
    });
    releaseFirst();
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(await store.transaction(ref, async (existing) => {
      expect(existing).toBe('envelope-second');
      return { sealed: existing!, result: 'settled' };
    })).toBe('settled');
  });

  it('should record and look up target keys without ever clobbering the envelope', async () => {
    const ref = freshRef();
    const store = createPostgresGitHubAppEnvelopeStore();
    expect(await store.lookup(ref)).toBeNull();
    await store.record(ref, 'radar-immobilier');
    expect(await store.lookup(ref)).toBe('radar-immobilier');
    await store.transaction(ref, async () => ({ sealed: 'envelope-two', result: 'created' }));
    // A later record (rotation/repair shape) must not touch the sealed column.
    await store.record(ref, 'sentropic');
    expect(await store.lookup(ref)).toBe('sentropic');
    expect(await store.transaction(ref, async (existing) => {
      expect(existing).toBe('envelope-two');
      return { sealed: existing!, result: 'kept' };
    })).toBe('kept');
  });

  it('should refuse malformed installation refs on every operation', async () => {
    const store = createPostgresGitHubAppEnvelopeStore();
    await expect(store.transaction('enroll_scoped../escape', async () => ({ sealed: 'x', result: 1 })))
      .rejects.toMatchObject({ code: 'invalid_request' });
    await expect(store.record('not-a-ref', 'radar-immobilier'))
      .rejects.toMatchObject({ code: 'invalid_request' });
    await expect(store.lookup('enroll_shaped-but-wrong')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(store.record(`enroll_${randomUUID()}`, '')).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
