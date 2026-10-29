import { createHash } from 'node:crypto';
import type {
  LiveCommit,
  LiveDocumentIdentity,
  LiveJournalEntry,
  LivePatchKey,
} from '../../../../packages/chat-core/src/live-document-port';

/** Stable digests also bind checkpoint watermarks to their encoded state. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}
export const digest = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');
export const commitDigest = (input: LiveCommit): string =>
  digest({
    ...input,
    formattingIntents: input.formattingIntents.map((intent) => {
      const { seq: _seq, ...semantic } = intent as typeof intent & {
        seq?: number;
      };
      return semantic;
    }),
  });
export function sequenceEntry(
  journal: readonly LiveJournalEntry[],
  input: LiveCommit,
  seq: number
): LiveJournalEntry {
  let intentSeq = journal.reduce(
    (total, entry) => total + entry.formattingIntents.length,
    0
  );
  return {
    ...input,
    seq,
    digest: commitDigest(input),
    formattingIntents: input.formattingIntents.map((intent) => ({
      ...intent,
      seq: ++intentSeq,
    })),
  };
}
export const patchKey = (key: LivePatchKey): string => canonical([
  key.documentId, key.actorId, key.sessionEpoch, key.patchId,
]);
export const transactionKey = (input: LiveCommit): string => canonical([
  input.sessionId, input.actorId, input.sessionEpoch, input.transactionId,
]);
export function duplicate(journal: readonly LiveJournalEntry[], input: LiveCommit): LiveJournalEntry | undefined {
  const previous = journal.find(e => transactionKey(e) === transactionKey(input));
  if (previous) {
    if (previous.digest !== commitDigest(input))
      throw new Error('idempotency-conflict');
    return previous;
  }
  const terminal = input.receipt && journal.find(e => e.receipt && patchKey(e.receipt.key) === patchKey(input.receipt!.key));
  if (terminal && terminal.receipt!.payloadHash !== input.receipt!.payloadHash) throw new Error('idempotency-conflict');
  return terminal || undefined;
}
export function validateCommit(identity: LiveDocumentIdentity, input: LiveCommit): void {
  if (![input.transactionId, input.sessionId, input.actorId, input.sessionEpoch].every(v => typeof v === 'string' && v.length)) {
    throw new Error('invalid-journal-identity');
  }
  if (input.receipt) {
    const { key, status, payloadHash } = input.receipt;
    if (key.documentId !== identity.documentId || key.actorId !== input.actorId
      || key.sessionEpoch !== input.sessionEpoch || !key.patchId || !payloadHash
      || !['applied', 'refused'].includes(status)) throw new Error('invalid-terminal-receipt');
    if (status === 'refused' && input.encodedUpdate !== null) throw new Error('refused-update');
  }
  const ids = new Set<string>();
  for (const intent of input.formattingIntents) {
    if (!intent.intentId || ids.has(intent.intentId) || intent.actorId !== input.actorId
      || !['bold', 'italic', 'code'].includes(intent.mark)
      || (intent.value !== true && intent.value !== null)) throw new Error('invalid-formatting-intent');
    ids.add(intent.intentId);
    if (intent.source.kind === 'agent-patch' && (!input.receipt
      || patchKey(intent.source.key) !== patchKey(input.receipt.key))) throw new Error('intent-patch-mismatch');
  }
}

/** H2 retains the FULL history and provenance. No destructive GC is enabled.
 * This deliberately protects retained reads, inverse targets, baseline manifests
 * and pending publication recovery without inventing a storage expiry policy.
 * H10 must qualify a DS §5.6-compatible policy before enabling any deletion. */
export const liveRetention = Object.freeze({
  journal: 'retain-all', checkpoints: 'retain-all', provenance: 'retain-all',
  inverseRecords: 'retain-all', baselines: 'retain-all', pendingPublication: 'retain-all',
});
