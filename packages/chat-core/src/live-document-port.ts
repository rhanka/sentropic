/** Host persistence port informed by DS canvas-live §7.4. Bytes are base64.
 * DS/Focus-shaped types below (receipts, affected items, formatting intents,
 * actor kinds and paragraphs) are provisional host-port mirrors, not DS conformance.
 * H3 must replace them with exact published DS canvas-live / Focus editing imports
 * when those versions expose these contracts, before provider conformance is claimed.
 * A codec must preserve item identities and delete sets (including inverse targets).
 * Authentication/admission is supplied by the host, never by a client payload. */
export interface LiveDocumentIdentity {
  tenantId: string;
  workspaceId: string;
  documentId: string;
}
export interface LiveBaseline {
  documentRef: string;
  baseHash: string;
  manifestBaseHash: string;
  manifestId: string;
  lineageId: string;
  headAtOpen: string | null;
  production: {
    producerId: string;
    generationId: string;
    requestId: string;
  } | null;
  fields: readonly {
    fieldKey: string;
    address: Pick<LiveParagraph, "nodeId" | "targetRef" | "field" | "format">;
  }[];
  paragraphs: readonly LiveParagraph[];
}
/** Provisional ParagraphValue mirror at h2a 98060bd0a, Focus editing 0.5.0 (unpublished).
 * The host injects that API; no app-local Focus implementation is substituted. */
export interface LiveParagraph {
  documentRef: string;
  nodeId: string;
  targetRef: string;
  field:
    | "markdown"
    | "question"
    | "recommendedAnswer"
    | "context"
    | "label"
    | "body"
    | "consequence";
  paragraphId: string;
  blockKind: "paragraph";
  format: "text/plain" | "focus.markdown.p0@1";
  text: string;
}
export interface LivePatchKey {
  documentId: string;
  actorId: string;
  sessionEpoch: string;
  patchId: string;
}
export interface LiveReceipt {
  key: LivePatchKey;
  payloadHash: string;
  status: "applied" | "refused";
  reason?: string;
  conflict?: unknown;
  stateVectorAfter?: string;
  detail?: string;
  duplicate?: boolean;
  /** Wire inputs may carry these; the durable boundary MUST refuse them. */
  transient?: boolean;
  retryAfterMs?: number;
  operationResults: readonly unknown[];
  affectedItems: readonly LiveAffectedItems[];
}
/** DS §5.6 R-REV-2: sufficient inverse data survives a process restart. */
export interface LiveAffectedItems {
  fieldKey: string;
  operationIndex: number;
  kind: "insert" | "delete" | "split" | "merge" | "mark";
  insertedItems: readonly {
    client: number;
    clockRanges: readonly { start: number; end: number }[];
  }[];
  deletedItems: readonly {
    text: string;
    marks: readonly unknown[];
    isHardBreak: boolean;
    anchorBefore: string;
    anchorAfter: string;
  }[];
  separatorItem?: {
    paragraphId: string;
    payload: unknown;
    item: { client: number; clock: number };
    anchorBefore?: string;
    anchorAfter?: string;
  };
  markIntentIds: readonly string[];
  stateVectorBefore: string;
  stateVectorAfter: string;
}
export interface LiveFormattingIntent {
  intentId: string;
  actorId: string;
  fieldKey: string;
  source:
    | { kind: "agent-patch"; key: LivePatchKey; operationIndex: number }
    | { kind: "human-transaction"; transactionId: string };
  mark: "bold" | "italic" | "code";
  value: true | null;
  range: { start: string; end: string };
  items: readonly { client: number; clock: number }[];
}
/** Provisional H1 admission mirror; bind to AdmissionRecord at host composition.
 * Epoch survives reconnect and changes only on new admission. */
export interface LiveAdmission extends LiveDocumentIdentity {
  sessionId: string;
  sessionEpoch: string;
  profileId: string;
  schemaEpoch: string;
  actor: {
    actorId: string;
    kind: "human" | "agent" | "nhi";
    displayLabel: string;
    color: string;
  };
  fields: string[];
  operations: string[];
  closed: boolean;
}
export type LiveSessionRecord =
  | { kind: "admission"; admission: LiveAdmission }
  | {
      kind: "migration";
      target: "authoritative-document" | "preserved-draft";
      actorId: string;
      sessionEpoch: string;
      origin: string;
      fromSchemaEpoch: string;
      toSchemaEpoch: string;
      draftId?: string;
      beforeDigest: string;
      afterDigest: string;
    }
  | {
      kind: "acknowledgement";
      actorId: string;
      sessionEpoch: string;
      digest: string;
      profileId?: string;
      schemaEpoch?: string;
      draftId?: string;
    }
  | {
      kind: "roster";
      actors: readonly {
        actorId: string;
        origin: string;
        awarenessClientId: number;
      }[];
    }
  | {
      kind: "freeze";
      returnId: string;
      lineageId: string;
      head: string | null;
      excludedActorIds: readonly string[];
      captureDigest: string;
      pendingPublication: boolean;
    }
  | {
      kind: "ingress-refusal";
      actorId: string;
      reason: string;
      payloadHash: string;
    }
  | {
      kind: "revert";
      key: LivePatchKey;
      revertId: string;
      revertedBy: string;
      receipt: unknown;
    };
export interface LiveCommit {
  transactionId: string;
  sessionId: string;
  actorId: string;
  sessionEpoch: string;
  encodedUpdate: string | null;
  receipt?: LiveReceipt;
  formattingIntents: readonly LiveFormattingIntent[];
  records: readonly LiveSessionRecord[];
}
export interface LiveJournalEntry extends LiveCommit {
  seq: number;
  digest: string;
  formattingIntents: readonly (LiveFormattingIntent & { seq: number })[];
}
export interface LiveCheckpoint {
  checkpointId: string;
  documentId: string;
  encodedState: string;
  stateVector: string;
  journalWatermark: number;
  schemaEpoch: string;
  createdAt: string;
  createdBy: string;
  digest: string;
}
export interface LiveDocumentState {
  identity: LiveDocumentIdentity;
  baseline: LiveBaseline;
  schemaEpoch: string;
  head: number;
  checkpoint: LiveCheckpoint | null;
  journal: LiveJournalEntry[];
}
export interface LiveDocumentStore {
  open(
    identity: LiveDocumentIdentity,
    baseline: LiveBaseline,
    schemaEpoch: string,
  ): Promise<LiveDocumentState>;
  load(identity: LiveDocumentIdentity): Promise<LiveDocumentState>;
  commit(
    identity: LiveDocumentIdentity,
    expectedHead: number,
    commit: LiveCommit,
  ): Promise<LiveJournalEntry>;
  checkpoint(
    identity: LiveDocumentIdentity,
    expectedHead: number,
    checkpoint: LiveCheckpoint,
  ): Promise<void>;
}
