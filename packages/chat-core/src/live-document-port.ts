/** Host persistence contract, frozen DS canvas-live §7.4. Bytes are base64.
 * A codec must preserve item identities and delete sets (including inverse targets).
 * Authentication/admission is supplied by the host, never by a client payload. */
export interface LiveDocumentIdentity {
  tenantId: string; workspaceId: string; documentId: string;
}
export interface LiveBaseline {
  documentRef: string; baseHash: string; manifestBaseHash: string;
  manifestId: string; lineageId: string; headAtOpen: string | null;
  production: { producerId: string; generationId: string; requestId: string } | null;
  fields: readonly { fieldKey: string; address: Pick<LiveParagraph, 'nodeId' | 'targetRef' | 'field' | 'format'> }[];
  paragraphs: readonly LiveParagraph[];
}
/** Exact ParagraphValue address at h2a 98060bd0a, Focus editing 0.5.0.
 * The host injects that API; no app-local Focus implementation is substituted. */
export interface LiveParagraph {
  documentRef: string; nodeId: string; targetRef: string;
  field: 'markdown' | 'question' | 'recommendedAnswer' | 'context' | 'label' | 'body' | 'consequence';
  paragraphId: string; blockKind: 'paragraph';
  format: 'text/plain' | 'focus.markdown.p0@1'; text: string;
}
export interface LivePatchKey {
  documentId: string; actorId: string; sessionEpoch: string; patchId: string;
}
export interface LiveReceipt {
  key: LivePatchKey; payloadHash: string;
  status: 'applied' | 'refused'; operationResults: readonly unknown[];
  affectedItems: readonly LiveAffectedItems[];
}
/** DS §5.6 R-REV-2: sufficient inverse data survives a process restart. */
export interface LiveAffectedItems {
  fieldKey: string; operationIndex: number;
  kind: 'insert' | 'delete' | 'split' | 'merge' | 'mark';
  insertedItems: readonly { client: number; clockRanges: readonly { start: number; end: number }[] }[];
  deletedItems: readonly { text: string; marks: readonly string[]; isHardBreak: boolean;
    anchorBefore: string; anchorAfter: string }[];
  separatorItem?: { paragraphId: string; payload: unknown; item: { client: number; clock: number };
    anchorBefore?: string; anchorAfter?: string };
  markIntentIds: readonly string[]; stateVectorBefore: string; stateVectorAfter: string;
}
export interface LiveFormattingIntent {
  intentId: string; actorId: string; fieldKey: string;
  source: { kind: 'agent-patch'; key: LivePatchKey; operationIndex: number }
    | { kind: 'human-transaction'; transactionId: string };
  mark: 'bold' | 'italic' | 'code'; value: true | null;
  range: { from: string; to: string };
  items: readonly { client: number; clock: number }[];
}
/** H1 admission facts: epoch survives reconnect and changes only on new admission. */
export interface LiveAdmission extends LiveDocumentIdentity {
  sessionId: string; sessionEpoch: string; profileId: string; schemaEpoch: string;
  actor: { actorId: string; kind: 'human' | 'agent' | 'nhi'; displayLabel: string; color: string };
  fields: string[]; operations: string[]; closed: boolean;
}
export type LiveSessionRecord =
  | { kind: 'admission'; admission: LiveAdmission }
  | { kind: 'acknowledgement'; actorId: string; sessionEpoch: string; digest: string }
  | { kind: 'roster'; actors: readonly { actorId: string; origin: string; awarenessClientId: number }[] }
  | { kind: 'freeze'; returnId: string; lineageId: string; head: string | null;
      excludedActorIds: readonly string[]; captureDigest: string; pendingPublication: boolean }
  | { kind: 'ingress-refusal'; actorId: string; reason: string; payloadHash: string }
  | { kind: 'revert'; key: LivePatchKey; revertId: string; revertedBy: string; receipt: unknown };
export interface LiveCommit {
  transactionId: string; sessionId: string; actorId: string; sessionEpoch: string;
  encodedUpdate: string | null; receipt?: LiveReceipt;
  formattingIntents: readonly LiveFormattingIntent[];
  records: readonly LiveSessionRecord[];
}
export interface LiveJournalEntry extends LiveCommit {
  seq: number; digest: string;
  formattingIntents: readonly (LiveFormattingIntent & { seq: number })[];
}
export interface LiveCheckpoint {
  checkpointId: string; documentId: string; encodedState: string; stateVector: string;
  journalWatermark: number; schemaEpoch: string; createdAt: string; createdBy: string;
  digest: string;
}
export interface LiveDocumentState {
  identity: LiveDocumentIdentity; baseline: LiveBaseline; schemaEpoch: string;
  head: number; checkpoint: LiveCheckpoint | null; journal: LiveJournalEntry[];
}
export interface LiveDocumentStore {
  open(identity: LiveDocumentIdentity, baseline: LiveBaseline, schemaEpoch: string): Promise<LiveDocumentState>;
  load(identity: LiveDocumentIdentity): Promise<LiveDocumentState>;
  commit(identity: LiveDocumentIdentity, expectedHead: number, commit: LiveCommit): Promise<LiveJournalEntry>;
  checkpoint(identity: LiveDocumentIdentity, expectedHead: number, checkpoint: LiveCheckpoint): Promise<void>;
}
