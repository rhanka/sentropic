import type {
  LiveAdmission, LiveBaseline, LiveCheckpoint, LiveCommit, LiveDocumentIdentity,
  LiveDocumentState, LiveDocumentStore, LiveJournalEntry,
} from '../../../../packages/chat-core/src/live-document-port';
import { commitDigest, digest, duplicate, validateCommit } from './journal';

export interface DocumentCodec<D> {
  create(): D;
  apply(doc: D, encodedUpdate: string): void;
  encode(doc: D): string;
  vector(doc: D): string;
  destroy(doc: D): void;
}
export const sealCheckpoint = (input: Omit<LiveCheckpoint, 'digest'>): LiveCheckpoint => ({ ...input, digest: digest(input) });
export function verifyCheckpoint(checkpoint: LiveCheckpoint, state: Pick<LiveDocumentState, 'identity' | 'schemaEpoch' | 'head'>): void {
  const { digest: expected, ...input } = checkpoint;
  if (digest(input) !== expected || checkpoint.documentId !== state.identity.documentId
    || checkpoint.schemaEpoch !== state.schemaEpoch || !Number.isSafeInteger(checkpoint.journalWatermark)
    || checkpoint.journalWatermark < 0 || checkpoint.journalWatermark > state.head) throw new Error('checkpoint-integrity');
}
export function restoreDocument<D>(state: LiveDocumentState, codec: DocumentCodec<D>): D {
  const checkpoint = state.checkpoint;
  if (checkpoint) verifyCheckpoint(checkpoint, state);
  if (state.journal.length !== state.head) throw new Error('journal-gap');
  let intentSeq = 0;
  for (const [index, entry] of state.journal.entries()) {
    const { seq, digest: expected, ...input } = entry;
    if (seq !== index + 1) throw new Error('journal-gap');
    if (commitDigest(input) !== expected) throw new Error('journal-integrity');
    for (const intent of entry.formattingIntents) {
      if (intent.seq !== ++intentSeq) throw new Error('formatting-order');
    }
  }
  const doc = codec.create();
  try {
    if (checkpoint) {
      codec.apply(doc, checkpoint.encodedState);
      if (codec.vector(doc) !== checkpoint.stateVector) throw new Error('checkpoint-vector');
      // Full history is retained in H2. Verify actual watermark coverage as well
      // as the seal, so even a resealed stale checkpoint cannot omit an update.
      const prefix = codec.create();
      try {
        for (const entry of state.journal) {
          if (entry.seq <= checkpoint.journalWatermark && entry.encodedUpdate !== null) codec.apply(prefix, entry.encodedUpdate);
        }
        if (codec.encode(prefix) !== codec.encode(doc)) throw new Error('checkpoint-coverage');
      } finally { codec.destroy(prefix); }
    }
    for (const entry of state.journal) {
      if (entry.seq > (checkpoint?.journalWatermark ?? 0) && entry.encodedUpdate !== null) codec.apply(doc, entry.encodedUpdate);
    }
    return doc;
  } catch (error) { codec.destroy(doc); throw error; }
}

/** Structural H1 AdmissionAuthority.check contract. The authenticated registry is
 * injected by composition after H1 merges; request JSON is never this authority. */
export interface AdmissionRegistry {
  check(record: LiveAdmission, field: string, operation: string): Promise<LiveAdmission>;
}
export class DurableSession<D> {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly identity: LiveDocumentIdentity;
  constructor(private readonly store: LiveDocumentStore, private readonly codec: DocumentCodec<D>,
    private readonly registry: AdmissionRegistry, private readonly admission: LiveAdmission,
    private readonly field: string) {
    this.identity = { tenantId: admission.tenantId, workspaceId: admission.workspaceId, documentId: admission.documentId };
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
  private async check(operation: string): Promise<void> {
    const current = await this.registry.check(this.admission, this.field, operation);
    for (const key of ['tenantId', 'workspaceId', 'documentId', 'sessionId', 'sessionEpoch', 'schemaEpoch', 'profileId'] as const) {
      if (current[key] !== this.admission[key]) throw new Error('admission-identity-mismatch');
    }
    if (current.closed || current.actor.actorId !== this.admission.actor.actorId
      || current.actor.kind !== this.admission.actor.kind) throw new Error('admission-identity-mismatch');
  }
  open(baseline: LiveBaseline): Promise<void> {
    return this.exclusive(async () => {
      await this.check('read');
      await this.store.open(this.identity, baseline, this.admission.schemaEpoch);
    });
  }
  snapshot(): Promise<{ encodedState: string; stateVector: string; head: number }> {
    return this.exclusive(async () => {
      await this.check('read');
      const state = await this.store.load(this.identity);
      const doc = restoreDocument(state, this.codec);
      try { return { encodedState: this.codec.encode(doc), stateVector: this.codec.vector(doc), head: state.head }; }
      finally { this.codec.destroy(doc); }
    });
  }
  checkpoint(checkpointId: string, createdAt: string, createdBy: string): Promise<LiveCheckpoint> {
    return this.exclusive(async () => {
      await this.check('read');
      const state = await this.store.load(this.identity);
      const doc = restoreDocument(state, this.codec);
      try {
        const checkpoint = sealCheckpoint({ checkpointId, documentId: this.identity.documentId,
          encodedState: this.codec.encode(doc), stateVector: this.codec.vector(doc),
          journalWatermark: state.head, schemaEpoch: state.schemaEpoch, createdAt, createdBy });
        await this.store.checkpoint(this.identity, state.head, checkpoint);
        return checkpoint;
      } finally { this.codec.destroy(doc); }
    });
  }
  accept(input: LiveCommit, publish: (entry: LiveJournalEntry) => Promise<void>): Promise<LiveJournalEntry> {
    // Copy before queuing: a caller cannot mutate validated bytes while awaiting a lock.
    const frozen = structuredClone(input);
    return this.exclusive(async () => {
      await this.check('edit');
      if (frozen.actorId !== this.admission.actor.actorId || frozen.sessionEpoch !== this.admission.sessionEpoch
        || frozen.sessionId !== this.admission.sessionId) throw new Error('commit-admission-mismatch');
      validateCommit(this.identity, frozen);
      if (this.admission.actor.kind === 'agent' && !frozen.receipt) throw new Error('agent-receipt-required');
      const state = await this.store.load(this.identity);
      const previous = duplicate(state.journal, frozen);
      if (previous) return previous;
      // Always reconstruct committed state. Candidates never enter a shared doc.
      // A failed/ambiguous commit discards this clone, including its tombstones;
      // the next operation must load committed state again before serving anything.
      const candidate = restoreDocument(state, this.codec);
      try {
        if (frozen.encodedUpdate !== null) this.codec.apply(candidate, frozen.encodedUpdate);
        const entry = await this.store.commit(this.identity, state.head, frozen);
        await publish(structuredClone(entry));
        return entry;
      } finally { this.codec.destroy(candidate); }
    });
  }
}
