import type { CollaborationActor, OpenSessionInput } from './contracts';

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
  constructor(private readonly ports: AdmissionPorts) {}
  async open(_input: OpenSessionInput): Promise<AdmissionRecord> { throw new Error('H1 admission not implemented'); }
  async check(_record: AdmissionRecord, _field: string, _operation: string): Promise<AdmissionRecord> { throw new Error('H1 authorization not implemented'); }
  async close(_record: AdmissionRecord): Promise<void> { throw new Error('H1 close not implemented'); }
}
