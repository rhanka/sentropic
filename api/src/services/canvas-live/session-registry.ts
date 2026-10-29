import type { AdmissionRecord } from './admission';
import type { CollaborationActor, FieldBindingIdentity } from './contracts';

// The H3 factory supplies actual Y.Doc/Y.Text/Y.Map/Awareness instances.
export interface SessionResource {
  document: { getText(name: string): unknown; getMap(name: string): { set(key: string, value: unknown): void } };
  awareness: { remove(clientId: number): void };
  connect(): () => void;
}
export interface RegistryActor { actor: CollaborationActor; awarenessClientId: number }
export interface RegistryBinding { identity: FieldBindingIdentity; text: unknown; fieldMeta: unknown; awareness: SessionResource['awareness'] }
export class SessionRegistry {
  constructor(private readonly factory: { create(record: AdmissionRecord): SessionResource; clientId(): number }) {}
  open(_record: AdmissionRecord, _fieldKey: string): { kind: 'live-session'; identity: FieldBindingIdentity; dispose(): Promise<void> } { throw new Error('H1 binding not implemented'); }
  resolveBinding(_record: AdmissionRecord, _identity: FieldBindingIdentity): RegistryBinding { throw new Error('H1 resolution not implemented'); }
  subscribeActors(_record: AdmissionRecord, _callback: (actors: RegistryActor[]) => void): () => void { throw new Error('H1 registry updates not implemented'); }
  revoke(_record: AdmissionRecord): void { throw new Error('H1 revocation not implemented'); }
}
