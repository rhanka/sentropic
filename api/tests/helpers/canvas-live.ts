import * as Y from 'yjs';
import type {
  LiveAdmission, LiveBaseline, LiveCommit, LiveDocumentIdentity, LiveDocumentState,
  LiveDocumentStore, LiveFormattingIntent, LiveJournalEntry,
} from '../../../packages/chat-core/src/live-document-port';
import { sequenceEntry } from '../../src/services/canvas-live/journal';

export const identity: LiveDocumentIdentity = {
  tenantId: 'tenant-a', workspaceId: 'workspace-a', documentId: 'canvas:artifact-a',
};
export const paragraph = (text: string) => ({
  documentRef: 'focus:dossier', nodeId: 'node-a', targetRef: 'target-a', field: 'body' as const,
  paragraphId: 'paragraph-a', blockKind: 'paragraph' as const, format: 'text/plain' as const, text,
});
export const baseline: LiveBaseline = {
  documentRef: 'focus:dossier', baseHash: 'base-a', manifestBaseHash: 'manifest-hash-a',
  manifestId: 'manifest-a', lineageId: 'lineage-a', headAtOpen: null, production: null,
  fields: [{ fieldKey: 'body', address: { nodeId: 'node-a', targetRef: 'target-a', field: 'body', format: 'text/plain' } }],
  paragraphs: [paragraph('baseline')],
};
export const admission: LiveAdmission = {
  ...identity, sessionId: 'session-a', sessionEpoch: 'epoch-a', profileId: 'prose', schemaEpoch: '1',
  actor: { actorId: 'agent-a', kind: 'agent', displayLabel: 'Agent A', color: '#123456' },
  fields: ['body'], operations: ['read', 'edit'], closed: false,
};
export const codec = {
  create: () => new Y.Doc({ gc: false }),
  apply: (doc: Y.Doc, bytes: string) => Y.applyUpdate(doc, Buffer.from(bytes, 'base64')),
  encode: (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
  vector: (doc: Y.Doc) => Buffer.from(Y.encodeStateVector(doc)).toString('base64'),
  destroy: (doc: Y.Doc) => doc.destroy(),
};
export const update = (doc: Y.Doc, change: (text: Y.Text) => void) => {
  const before = Y.encodeStateVector(doc);
  doc.transact(() => change(doc.getText('field:body')));
  return Buffer.from(Y.encodeStateAsUpdate(doc, before)).toString('base64');
};
export const commit = (encodedUpdate: string | null, transactionId = 'transaction-a'): LiveCommit => ({
  transactionId, sessionId: admission.sessionId, actorId: admission.actor.actorId,
  sessionEpoch: admission.sessionEpoch, encodedUpdate, records: [], formattingIntents: [],
  receipt: { key: { documentId: identity.documentId, actorId: admission.actor.actorId,
    sessionEpoch: admission.sessionEpoch, patchId: transactionId }, payloadHash: transactionId,
    status: 'applied', operationResults: [{ status: 'applied' }], affectedItems: [{
      fieldKey: 'body', operationIndex: 0, kind: 'insert',
      insertedItems: [{ client: 7, clockRanges: [{ start: 0, end: 1 }] }], deletedItems: [],
      markIntentIds: [], stateVectorBefore: 'AA==', stateVectorAfter: 'AQcB',
    }] },
});
export const intent = (intentId: string): LiveFormattingIntent => ({
  intentId, actorId: admission.actor.actorId, fieldKey: 'body',
  source: { kind: 'agent-patch', key: commit(null).receipt!.key, operationIndex: 0 },
  mark: 'bold', value: true, range: { from: 'anchor-a', to: 'anchor-b' },
  items: [{ client: 7, clock: 0 }],
});

/** Storage fake only; H1's check() is called afresh on every operation. */
export const registry = {
  check: async (record: LiveAdmission, field: string, operation: string) => {
    if (record.closed || !record.fields.includes(field) || !record.operations.includes(operation)) {
      throw new Error('scope-denied');
    }
    return structuredClone(record);
  },
};
export class MemoryStore implements LiveDocumentStore {
  state!: LiveDocumentState;
  fail: 'before' | 'after' | null = null;
  async open(id: LiveDocumentIdentity, base: LiveBaseline, schemaEpoch: string) {
    this.state ??= { identity: id, baseline: base, schemaEpoch, head: 0, checkpoint: null, journal: [] };
    return this.load(id);
  }
  async load(id: LiveDocumentIdentity) {
    if (JSON.stringify(id) !== JSON.stringify(this.state.identity)) throw new Error('document-missing');
    return structuredClone(this.state);
  }
  async commit(_id: LiveDocumentIdentity, expectedHead: number, input: LiveCommit) {
    if (this.fail === 'before') throw new Error('crash-before-commit');
    if (expectedHead !== this.state.head) throw new Error('head-conflict');
    const entry: LiveJournalEntry = sequenceEntry(this.state.journal, structuredClone(input), ++this.state.head);
    this.state.journal.push(entry);
    if (this.fail === 'after') throw new Error('crash-after-commit');
    return structuredClone(entry);
  }
  async checkpoint(_id: LiveDocumentIdentity, _head: number, checkpoint: NonNullable<LiveDocumentState['checkpoint']>) {
    if (this.fail === 'before') throw new Error('crash-before-checkpoint');
    this.state.checkpoint = structuredClone(checkpoint);
    if (this.fail === 'after') throw new Error('crash-after-checkpoint');
  }
}
