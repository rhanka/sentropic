import type { ObjectIntent, PreparationIntentStore } from './object-intents.js';
import { blobDigestOfKey, type PublicationBlobStore } from './publication.js';
import type { DeletionClaimStore, RefcountStore } from './gc.js';

export interface PreparationCleanupHost {
  readonly intents: PreparationIntentStore;
  readonly blobs: PublicationBlobStore;
  readonly refs: RefcountStore;
  /** PostgreSQL callers retain the transaction-scoped exclusion through DELETE. */
  readonly claims: DeletionClaimStore;
  readonly cleanupBatchSize?: number;
}
export interface PreparationAttempt {
  readonly attemptId: string;
  readonly invocationId: string;
  readonly preparedAtMs: number;
  readonly cleanupDeadlineMs: number;
  readonly blobKeys: string[];
  readonly state: 'pending-cleanup' | 'failed' | 'failed-cleaned';
}

function preparation(intent: ObjectIntent): PreparationAttempt {
  const p = intent.payload;
  if (typeof p.attemptId !== 'string' || typeof p.invocationId !== 'string' ||
      typeof p.preparedAtMs !== 'number' || !Number.isFinite(p.preparedAtMs) ||
      typeof p.cleanupDeadlineMs !== 'number' || !Number.isFinite(p.cleanupDeadlineMs) ||
      p.cleanupDeadlineMs <= p.preparedAtMs || !Array.isArray(p.blobKeys) ||
      !p.blobKeys.every((key): key is string => typeof key === 'string')) throw new Error('invalid preparation metadata');
  return { attemptId: p.attemptId, invocationId: p.invocationId,
    preparedAtMs: p.preparedAtMs, cleanupDeadlineMs: p.cleanupDeadlineMs, blobKeys: [...p.blobKeys],
    state: p.cleanupState === 'failed-cleaned' ? 'failed-cleaned' : intent.state === 'failed' ? 'failed' : 'pending-cleanup' };
}

async function hasResidualBytes(host: PreparationCleanupHost, attempt: PreparationAttempt): Promise<boolean> {
  for (const key of attempt.blobKeys) {
    const digest = blobDigestOfKey(key);
    if (await host.refs.count(digest) === 0 && !await host.refs.isPinned(digest) &&
        (await host.blobs.listKeys(key)).includes(key)) return true;
  }
  return false;
}

/** Historical attempt attribution plus current protection, scoped to one artifact. */
export async function inspectPreparations(host: PreparationCleanupHost, artifactId: string): Promise<{
  attempts: PreparationAttempt[]; protectedKeys: string[]; abandonedKeys: string[];
  invalidIntents: Array<{ intentId: string; error: string }>;
}> {
  const intents = await host.intents.listPreparationIntents({ artifactId });
  const attempts: PreparationAttempt[] = [];
  const invalidIntents: Array<{ intentId: string; error: string }> = [];
  for (const intent of intents) {
    let attempt: PreparationAttempt;
    try { attempt = preparation(intent); }
    catch (error) {
      invalidIntents.push({ intentId: intent.intentId, error: String(error) });
      continue;
    }
    attempts.push(attempt.state === 'failed-cleaned' && await hasResidualBytes(host, attempt)
      ? { ...attempt, state: 'failed' } : attempt);
  }
  const protectedKeys: string[] = [], abandonedKeys: string[] = [];
  for (const key of [...new Set(attempts.flatMap((attempt) => attempt.blobKeys))].sort()) {
    const digest = blobDigestOfKey(key);
    const protectedBlob = await host.refs.count(digest) > 0 || await host.refs.isPinned(digest);
    (protectedBlob ? protectedKeys : abandonedKeys).push(key);
  }
  return { attempts, protectedKeys, abandonedKeys, invalidIntents };
}

/** Run one deterministic, bounded sweep through the supplied clock deadline. */
export async function scheduleBoundedPreparationCleanup(host: PreparationCleanupHost, throughMs: number): Promise<void> {
  const limit = host.cleanupBatchSize ?? 100;
  if (!Number.isFinite(throughMs) || !Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid cleanup bound');
  const candidates = await host.intents.listPreparationIntents({ throughMs, limit });
  const failures: unknown[] = [];
  for (const candidate of candidates) {
    try {
      let previous: PreparationAttempt;
      try { previous = preparation(candidate); }
      catch (error) {
        await host.intents.markFailed(candidate.intentId, `invalid preparation metadata: ${candidate.intentId}`);
        throw error;
      }
      if (previous.state === 'failed-cleaned' && !await hasResidualBytes(host, previous)) continue;
      const intent = await host.intents.claimPreparationCleanup(candidate.intentId, throughMs);
      if (intent === undefined) continue;
      const attempt = preparation(intent);
      if (typeof intent.payload.releaseId !== 'string') throw new Error('preparation has no pin owner');
      for (const key of [...new Set(attempt.blobKeys)].sort()) {
        const digest = blobDigestOfKey(key);
        await host.claims.withDigestLock(digest, async (claims) => {
          try { await host.refs.unpin(digest, `preparation:${intent.payload.releaseId}`); }
          catch (error) { if (!(error instanceof Error) || !/not pinned/.test(error.message)) throw error; }
          if (await host.refs.count(digest) > 0 || await host.refs.isPinned(digest)) return;
          // A different purge owns its claim and acknowledges its own external DELETE.
          if (await claims.isClaimed(digest)) throw new Error('preparation cleanup blocked by deletion claim');
          await claims.claim(digest, `cleanup:${intent.intentId}`);
          try {
            if ((await host.blobs.listKeys(key)).includes(key)) await host.blobs.deleteBlob(key);
          } finally { await claims.releaseClaim(digest); }
        });
      }
      await host.intents.settlePreparationCleanup(intent.intentId);
    } catch (error) { failures.push(new Error(`preparation ${candidate.intentId}: ${String(error)}`, { cause: error })); }
  }
  if (failures.length) throw new AggregateError(failures, 'preparation cleanup failed; debt retained for retry');
}
