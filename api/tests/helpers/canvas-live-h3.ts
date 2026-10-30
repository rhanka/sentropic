import { vi } from 'vitest';
import * as Y from 'yjs';
import type { AdmissionRecord } from '../../../src/services/canvas-live/admission';
import { HocuspocusAuthContext, HocuspocusHost, type HocuspocusStore } from '../../src/services/canvas-live/hocuspocus';
import { SessionRegistry } from '../../src/services/canvas-live/session-registry';
import { splitForTransport } from '../../src/services/canvas-live/sync-framing';

export const admissionRecord = (fields: string[] = ['description', 'notes']): AdmissionRecord => ({
  tenantId: 't', workspaceId: 'w', documentId: 'canvas:a', sessionId: 's',
  sessionEpoch: 'epoch-1', profileId: 'full@1', schemaEpoch: '2',
  fields, operations: ['read', 'edit'], closed: false,
  actor: { actorId: 'human-a', kind: 'human', displayLabel: 'A', color: '#123456' },
});

export const contextFor = (record: AdmissionRecord): HocuspocusAuthContext => ({
  principal: { tenantId: record.tenantId, workspaceId: record.workspaceId, actorId: record.actor.actorId, actorKind: record.actor.kind },
  admission: record,
});

/** Real Yjs session resources so ingress classification runs against true shared types. */
export function registryFixture() {
  const awareness = { remove: vi.fn() };
  const registry = new SessionRegistry({
    create: () => {
      const doc = new Y.Doc({ gc: false });
      return {
        document: {
          getText: (name: string) => doc.getText(name),
          getMap: (name: string) => doc.getMap(name),
        },
        awareness,
        connect: () => () => {},
      };
    },
    clientId: (() => { let id = 0; return () => ++id; })(),
  });
  return { registry, awareness };
}

export const docOf = (registry: SessionRegistry, record: AdmissionRecord, fieldKey: string): Y.Doc => {
  const binding = registry.resolveBinding(record, { documentId: record.documentId, sessionId: record.sessionId, fieldKey });
  return (binding.text as Y.Text).doc as Y.Doc;
};

/** Delta update bytes produced by a client that cloned the authoritative state. */
export const deltaFrom = (authoritative: Y.Doc, edit: (client: Y.Doc) => void): Uint8Array => {
  const client = new Y.Doc({ gc: false });
  Y.applyUpdate(client, Y.encodeStateAsUpdate(authoritative));
  const before = Y.encodeStateVector(client);
  edit(client);
  return Y.encodeStateAsUpdate(client, before);
};

export const framesOf = (bytes: Uint8Array): Uint8Array[] => splitForTransport(bytes);

export interface HostFixture {
  host: HocuspocusHost;
  applied: { journalWatermark: number; bytes: Uint8Array }[];
  refusals: { actorId: string; documentId: string; refusal: string; at: string }[];
}

/** Validated-bridge host: validated updates apply to the session doc, journal first, then broadcast. */
export function hostFixture(options: {
  record: AdmissionRecord;
  registry: SessionRegistry;
  authorizeUpdate?: (context: HocuspocusAuthContext) => Promise<void>;
  resolveAdmission?: (actorId: string) => Promise<HocuspocusAuthContext | null>;
  store?: HocuspocusStore;
}): HostFixture {
  const applied: { journalWatermark: number; bytes: Uint8Array }[] = [];
  const refusals: HostFixture['refusals'] = [];
  let watermark = 0;
  const deps: ConstructorParameters<typeof HocuspocusHost>[0] = {
    authenticate: async () => contextFor(options.record),
    authorizeUpdate: async (context) => options.authorizeUpdate?.(context),
    registry: options.registry,
    applyValidated: async (context, update) => {
      const authoritative = (options.registry.resolveBinding(context.admission, update.identity).text as Y.Text).doc as Y.Doc;
      Y.applyUpdate(authoritative, update.bytes);
      const journalWatermark = ++watermark;
      applied.push({ journalWatermark, bytes: update.bytes });
      return { journalWatermark };
    },
    refusals: (entry) => { refusals.push(entry); },
  };
  if (options.resolveAdmission) deps.resolveAdmission = async (item) => options.resolveAdmission(item.actorId);
  if (options.store) deps.store = options.store;
  return { host: new HocuspocusHost(deps), applied, refusals };
}
