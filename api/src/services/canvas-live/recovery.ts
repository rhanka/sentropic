import type { Principal, DocumentFacts } from './admission';
export interface PreservedDraft {
  bytes: Uint8Array; profileId: string; schemaEpoch: string;
  prepared?: { branch: 'client-upgrade' | 'draft-migration'; profileId: string; schemaEpoch: string; bytes: Uint8Array; acknowledged: boolean };
}
export interface RecoveryPorts {
  update(key: string, change: (old?: PreservedDraft) => PreservedDraft): Promise<PreservedDraft>;
  migrate(bytes: Uint8Array, from: Pick<PreservedDraft, 'profileId' | 'schemaEpoch'>, to: DocumentFacts): Promise<Uint8Array>;
}
export class DraftRecovery {
  constructor(private readonly ports: RecoveryPorts) {}
  async preserve(_principal: Principal, _documentId: string, _id: string, _draft: PreservedDraft): Promise<PreservedDraft> { throw new Error('H1 preserve not implemented'); }
  async prepare(_principal: Principal, _facts: DocumentFacts, _id: string, _branch: 'client-upgrade' | 'draft-migration'): Promise<PreservedDraft> { throw new Error('H1 recovery not implemented'); }
  async acknowledge(_principal: Principal, _facts: DocumentFacts, _id: string): Promise<void> { throw new Error('H1 acknowledgement not implemented'); }
  async requireAcknowledged(_principal: Principal, _facts: DocumentFacts, _id: string): Promise<void> { throw new Error('H1 recovery gate not implemented'); }
}
