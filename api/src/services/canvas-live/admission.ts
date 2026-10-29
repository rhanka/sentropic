import type { CollaborationActor, OpenSessionInput } from './contracts';
import { AdmissionError } from './contracts';

export interface Principal { tenantId: string; workspaceId: string; actor: CollaborationActor }
export interface DocumentFacts { documentId: string; sessionId: string; profileId: string; schemaEpoch: string; fields: string[] }
export interface Grant extends Principal { documentId: string; fields: string[]; operations: string[] }
export interface AdmissionRecord extends Grant {
  sessionId: string; sessionEpoch: string; profileId: string; schemaEpoch: string; closed: boolean;
}
export interface AdmissionPorts {
  authenticate(): Promise<Principal>;
  authorize(principal: Principal, documentId: string): Promise<Grant | null>;
  document(principal: Principal, documentId: string): Promise<DocumentFacts>;
  update(key: string, change: (old?: AdmissionRecord) => AdmissionRecord): Promise<AdmissionRecord>;
  epoch(): string;
}
export class AdmissionAuthority {
  private readonly closedListeners = new Set<(record: AdmissionRecord) => void>();
  constructor(private readonly ports: AdmissionPorts) {}
  onClosed(callback: (record: AdmissionRecord) => void): () => void {
    this.closedListeners.add(callback);
    return () => { this.closedListeners.delete(callback); };
  }
  async open(input: OpenSessionInput): Promise<AdmissionRecord> {
    const principal = await this.ports.authenticate();
    if (!sameActor(principal.actor, input.actor)) throw new AdmissionError('actor-denied');
    const { grant, facts } = await this.current(principal, input.binding.documentId);
    if (!grant.fields.includes(input.binding.fieldKey) || !grant.operations.includes('read')) throw new AdmissionError('scope-denied');
    if (input.binding.sessionId !== undefined && input.binding.sessionId !== facts.sessionId) throw new AdmissionError('invalid-binding');
    return this.ports.update(admissionKey(principal, facts.documentId), (old) => {
      // An actor id cannot change kind within this document's admission history.
      if (old && !sameActor(old.actor, principal.actor)) throw new AdmissionError('actor-denied');
      if (input.profileId !== facts.profileId || input.schemaEpoch !== facts.schemaEpoch) throw new AdmissionError('incompatible-schema');
      const continuing = old && !old.closed;
      if (continuing && !old.fields.includes(input.binding.fieldKey)) throw new AdmissionError('scope-denied');
      return {
        ...grant, ...facts, actor: principal.actor,
        fields: continuing ? old.fields : grant.fields,
        operations: continuing ? old.operations : grant.operations,
        sessionEpoch: continuing ? old.sessionEpoch : this.ports.epoch(), closed: false,
      };
    });
  }
  async check(record: AdmissionRecord, field: string, operation: string): Promise<AdmissionRecord> {
    const principal = await this.ports.authenticate();
    this.assertOwner(principal, record);
    const { grant, facts } = await this.current(principal, record.documentId);
    const stored = await this.ports.update(admissionKey(principal, record.documentId), (old) => {
      this.assertActive(old, record);
      return old!;
    });
    if (stored.profileId !== facts.profileId || stored.schemaEpoch !== facts.schemaEpoch) throw new AdmissionError('incompatible-schema');
    if (!stored.fields.includes(field) || !grant.fields.includes(field)
      || !stored.operations.includes(operation) || !grant.operations.includes(operation)) throw new AdmissionError('scope-denied');
    return stored;
  }
  async close(record: AdmissionRecord): Promise<void> {
    const principal = await this.ports.authenticate();
    this.assertOwner(principal, record);
    const closed = await this.ports.update(admissionKey(principal, record.documentId), (old) => {
      this.assertActive(old, record);
      return { ...old!, closed: true };
    });
    for (const callback of this.closedListeners) callback(closed);
  }
  private async current(principal: Principal, documentId: string) {
    if (![principal.tenantId, principal.workspaceId, principal.actor.actorId, documentId].every(nonempty)) throw new AdmissionError('scope-denied');
    const grant = await this.ports.authorize(principal, documentId);
    if (!grant || grant.tenantId !== principal.tenantId || grant.workspaceId !== principal.workspaceId
      || grant.documentId !== documentId || !sameActor(grant.actor, principal.actor)) throw new AdmissionError('scope-denied');
    const facts = await this.ports.document(principal, documentId);
    if (facts.documentId !== documentId || !nonempty(facts.sessionId) || !nonempty(facts.profileId)
      || !/^(0|[1-9]\d*)$/.test(facts.schemaEpoch) || !validFields(facts.fields)
      || !grant.fields.every((field) => facts.fields.includes(field))) throw new AdmissionError('invalid-binding');
    return { grant, facts };
  }
  private assertOwner(principal: Principal, record: AdmissionRecord) {
    if (principal.tenantId !== record.tenantId || principal.workspaceId !== record.workspaceId
      || !sameActor(principal.actor, record.actor)) throw new AdmissionError('actor-denied');
  }
  private assertActive(old: AdmissionRecord | undefined, record: AdmissionRecord) {
    if (!old || old.closed || old.sessionEpoch !== record.sessionEpoch || old.sessionId !== record.sessionId) throw new AdmissionError('revoked');
  }
}
const nonempty = (value: string) => typeof value === 'string' && value.length > 0;
const sameActor = (a: CollaborationActor, b: CollaborationActor) => a.actorId === b.actorId && a.kind === b.kind;
export const validFields = (fields: string[]) => fields.length > 0 && new Set(fields).size === fields.length
  && fields.every((field) => nonempty(field) && !field.includes(':'));
export const admissionKey = (principal: Principal, documentId: string) => JSON.stringify([
  principal.tenantId, principal.workspaceId, documentId, principal.actor.actorId,
]);
