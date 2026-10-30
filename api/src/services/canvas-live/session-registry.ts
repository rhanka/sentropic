import type { AdmissionRecord } from './admission';
import { validFields } from './admission';
import type { CollaborationActor, FieldBindingIdentity } from './contracts';
import { AdmissionError } from './contracts';

// The H3 factory supplies actual Y.Doc/Y.Text/Y.Map/Awareness instances.
export interface SessionResource {
  document: { getText(name: string): unknown; getMap(name: string): { set(key: string, value: unknown): void } };
  awareness: { remove(clientId: number): void };
  connect(): () => void;
}
export interface RegistryActor { actor: CollaborationActor; awarenessClientId: number }
export interface RegistryBinding { identity: FieldBindingIdentity; text: unknown; fieldMeta: unknown; awareness: SessionResource['awareness'] }
interface LocalSession {
  resource: SessionResource; sessionId: string; profileId: string; schemaEpoch: string; disconnect?: () => void;
  bindings: Map<string, { binding: RegistryBinding; tokens: Set<object>; actorKey: string }>;
  actors: Map<string, RegistryActor>;
  closed?: boolean; retiredSessions: Set<string>;
}
const documentKey = (r: AdmissionRecord) => JSON.stringify([r.tenantId, r.workspaceId, r.documentId]);
const actorKey = (r: AdmissionRecord) => JSON.stringify([r.actor.actorId, r.sessionEpoch]);
const bindingKey = (r: AdmissionRecord, field: string) => JSON.stringify([actorKey(r), field]);
const admissionRef = (r: AdmissionRecord) => JSON.stringify([documentKey(r), r.sessionId, actorKey(r)]);
export class SessionRegistry {
  private readonly sessions = new Map<string, LocalSession>();
  private readonly listeners = new Map<string, Set<{ owner: string; sessionId: string; fieldKey?: string; callback: (actors: RegistryActor[]) => void }>>();
  private readonly revoked = new Set<string>();
  constructor(private readonly factory: { create(record: AdmissionRecord): SessionResource; clientId(): number }) {}
  open(record: AdmissionRecord, fieldKey: string) {
    this.assertAdmission(record);
    if (!/^(0|[1-9]\d*)$/.test(record.schemaEpoch)) throw new AdmissionError('incompatible-schema');
    if (record.closed || !validFields(record.fields) || !record.fields.includes(fieldKey)) throw new AdmissionError('invalid-binding');
    const key = documentKey(record); let session = this.sessions.get(key);
    if (!session) {
      const resource = this.factory.create(record);
      const meta = resource.document.getMap('meta');
      meta.set('profileId', record.profileId); meta.set('schemaEpoch', record.schemaEpoch);
      session = { resource, sessionId: record.sessionId, profileId: record.profileId, schemaEpoch: record.schemaEpoch, bindings: new Map(), actors: new Map(), retiredSessions: new Set() };
      this.sessions.set(key, session);
    }
    if (!session.bindings.size) {
      // Refresh the cached envelope from admitted authoritative facts; no text migration.
      if (session.retiredSessions.has(record.sessionId) || BigInt(record.schemaEpoch) < BigInt(session.schemaEpoch)
        || (record.schemaEpoch === session.schemaEpoch && record.profileId !== session.profileId)) throw new AdmissionError('incompatible-schema');
      if (session.closed && record.sessionId === session.sessionId && record.schemaEpoch === session.schemaEpoch) throw new AdmissionError('invalid-binding');
      if (session.sessionId !== record.sessionId) session.retiredSessions.add(session.sessionId);
      Object.assign(session, { sessionId: record.sessionId, profileId: record.profileId, schemaEpoch: record.schemaEpoch, closed: false });
    }
    this.assertSession(session, record);
    const identity = Object.freeze({ documentId: record.documentId, sessionId: record.sessionId, fieldKey });
    const entryKey = bindingKey(record, fieldKey); let entry = session.bindings.get(entryKey);
    if (!entry) {
      entry = { binding: { identity, text: session.resource.document.getText(`field:${fieldKey}`), fieldMeta: session.resource.document.getMap(`fieldmeta:${fieldKey}`), awareness: session.resource.awareness }, tokens: new Set(), actorKey: actorKey(record) };
      session.bindings.set(entryKey, entry);
    }
    session.disconnect ??= session.resource.connect();
    const token = {}; entry.tokens.add(token);
    if (!session.actors.has(actorKey(record))) {
      const awarenessClientId = this.factory.clientId();
      session.actors.set(actorKey(record), { actor: structuredClone(record.actor), awarenessClientId });
      this.emit(key, session);
    }
    const ownedSession = session; const ownedEntry = entry;
    return { kind: 'live-session' as const, identity, dispose: async () => {
      if (!ownedEntry.tokens.delete(token)) return;
      if (ownedEntry.tokens.size === 0) ownedSession.bindings.delete(entryKey);
      this.prune(key, ownedSession);
    } };
  }
  resolveBinding(record: AdmissionRecord, identity: FieldBindingIdentity): RegistryBinding {
    this.assertAdmission(record);
    const session = this.sessions.get(documentKey(record));
    if (!identity || !session || record.closed || identity.documentId !== record.documentId
      || identity.sessionId !== record.sessionId || !record.fields.includes(identity.fieldKey)) throw new AdmissionError('invalid-binding');
    this.assertSession(session, record);
    const entry = session.bindings.get(bindingKey(record, identity.fieldKey));
    if (!entry?.tokens.size) throw new AdmissionError('invalid-binding');
    return entry.binding;
  }
  subscribeActors(record: AdmissionRecord, callback: (actors: RegistryActor[]) => void, fieldKey?: string): () => void {
    this.assertAdmission(record);
    const session = this.sessions.get(documentKey(record));
    if (session) this.assertSession(session, record);
    const key = documentKey(record); const callbacks = this.listeners.get(key) ?? new Set();
    const listener = { owner: admissionRef(record), sessionId: record.sessionId, fieldKey, callback };
    this.listeners.set(key, callbacks); callbacks.add(listener);
    callback(structuredClone([...this.sessions.get(key)?.actors.values() ?? []]));
    return () => { callbacks.delete(listener); if (!callbacks.size) this.listeners.delete(key); };
  }
  revoke(record: AdmissionRecord): void {
    this.revoked.add(admissionRef(record));
    const key = documentKey(record); const session = this.sessions.get(key);
    this.dropListeners(key, (listener) => listener.owner === admissionRef(record));
    if (!session || session.sessionId !== record.sessionId) return;
    for (const [entryKey, entry] of session.bindings) if (entry.actorKey === actorKey(record)) {
      entry.tokens.clear(); session.bindings.delete(entryKey);
    }
    this.prune(key, session);
  }
  releaseField(record: AdmissionRecord, fieldKey: string): void {
    const key = documentKey(record); const session = this.sessions.get(key);
    if (!session || session.sessionId !== record.sessionId) return;
    const entryKey = bindingKey(record, fieldKey); const entry = session.bindings.get(entryKey);
    if (entry) { entry.tokens.clear(); session.bindings.delete(entryKey); }
    this.dropListeners(key, (listener) => listener.owner === admissionRef(record) && listener.fieldKey === fieldKey);
    this.prune(key, session);
  }
  closeSession(record: AdmissionRecord): void {
    const key = documentKey(record); const session = this.sessions.get(key);
    if (!session || session.sessionId !== record.sessionId) throw new AdmissionError('invalid-binding');
    for (const entry of session.bindings.values()) entry.tokens.clear();
    session.bindings.clear(); session.closed = true;
    this.dropListeners(key, (listener) => listener.sessionId === record.sessionId);
    this.prune(key, session);
  }
  private assertAdmission(record: AdmissionRecord) {
    if (record.closed || this.revoked.has(admissionRef(record))) throw new AdmissionError('revoked');
  }
  private assertSession(session: LocalSession, record: AdmissionRecord) {
    if (session.closed || session.sessionId !== record.sessionId) throw new AdmissionError('invalid-binding');
    if (session.profileId !== record.profileId || session.schemaEpoch !== record.schemaEpoch) throw new AdmissionError('incompatible-schema');
  }
  private prune(key: string, session: LocalSession) {
    for (const [id, actor] of session.actors) if (![...session.bindings.values()].some((entry) => entry.actorKey === id)) {
      session.actors.delete(id); session.resource.awareness.remove(actor.awarenessClientId);
      this.dropListeners(key, (listener) => listener.owner === JSON.stringify([key, session.sessionId, id]));
    }
    if (!session.bindings.size) { session.disconnect?.(); session.disconnect = undefined; }
    this.emit(key, session);
  }
  private emit(key: string, session: LocalSession) {
    for (const listener of this.listeners.get(key) ?? []) listener.callback(structuredClone([...session.actors.values()]));
  }
  private dropListeners(key: string, matches: (listener: { owner: string; sessionId: string; fieldKey?: string }) => boolean) {
    const listeners = this.listeners.get(key);
    for (const listener of listeners ?? []) if (matches(listener)) { listeners!.delete(listener); listener.callback([]); }
    if (!listeners?.size) this.listeners.delete(key);
  }
}
