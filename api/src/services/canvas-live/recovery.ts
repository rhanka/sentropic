import type { Principal, DocumentFacts } from './admission';
import { admissionKey } from './admission';
import { AdmissionError } from './contracts';
export interface PreservedDraft {
  bytes: Uint8Array; profileId: string; schemaEpoch: string;
  prepared?: { branch: 'client-upgrade' | 'draft-migration'; profileId: string; schemaEpoch: string; bytes: Uint8Array; acknowledged: boolean };
}
export interface RecoveryPorts {
  update(key: string, change: (old?: PreservedDraft) => PreservedDraft): Promise<PreservedDraft>;
  migrate(bytes: Uint8Array, from: Pick<PreservedDraft, 'profileId' | 'schemaEpoch'>, to: DocumentFacts): Promise<Uint8Array>;
  pending(key: string, draftId?: string): Promise<string | null>;
}
export class DraftRecovery {
  constructor(private readonly ports: RecoveryPorts) {}
  async preserve(principal: Principal, documentId: string, id: string, draft: PreservedDraft): Promise<PreservedDraft> {
    const saved = await this.ports.update(this.key(principal, documentId, id), (old) => old ?? {
      bytes: draft.bytes.slice(), profileId: draft.profileId, schemaEpoch: draft.schemaEpoch,
    });
    await this.ports.pending(admissionKey(principal, documentId), id);
    return saved;
  }
  async requirePendingAcknowledged(principal: Principal, facts: DocumentFacts): Promise<void> {
    const id = await this.ports.pending(admissionKey(principal, facts.documentId));
    if (id) await this.requireAcknowledged(principal, facts, id);
  }
  async prepare(principal: Principal, facts: DocumentFacts, id: string, branch: 'client-upgrade' | 'draft-migration'): Promise<PreservedDraft> {
    if (branch !== 'client-upgrade' && branch !== 'draft-migration') throw new AdmissionError('incompatible-schema');
    const key = this.key(principal, facts.documentId, id);
    const draft = await this.ports.update(key, requireDraft);
    // Only a copy of the preserved draft enters the migration port, never a document binding.
    const bytes = branch === 'draft-migration'
      ? await this.ports.migrate(draft.bytes.slice(), { profileId: draft.profileId, schemaEpoch: draft.schemaEpoch }, structuredClone(facts))
      : draft.bytes.slice();
    return this.ports.update(key, (old) => ({ ...requireDraft(old), prepared: {
      branch, profileId: facts.profileId, schemaEpoch: facts.schemaEpoch, bytes: bytes.slice(), acknowledged: false,
    } }));
  }
  async acknowledge(principal: Principal, facts: DocumentFacts, id: string): Promise<void> {
    await this.ports.update(this.key(principal, facts.documentId, id), (old) => {
      const draft = requireDraft(old); const prepared = compatible(draft, facts);
      return { ...draft, prepared: { ...prepared, acknowledged: true } };
    });
  }
  async requireAcknowledged(principal: Principal, facts: DocumentFacts, id: string): Promise<void> {
    await this.ports.update(this.key(principal, facts.documentId, id), (old) => {
      const draft = requireDraft(old);
      if (!compatible(draft, facts).acknowledged) throw new AdmissionError('incompatible-schema');
      return draft;
    });
  }
  private key(principal: Principal, documentId: string, id: string) {
    if (!id) throw new AdmissionError('incompatible-schema');
    return JSON.stringify([admissionKey(principal, documentId), id]);
  }
}
function requireDraft(draft?: PreservedDraft): PreservedDraft {
  if (!draft) throw new AdmissionError('incompatible-schema');
  return draft;
}
function compatible(draft: PreservedDraft, facts: DocumentFacts) {
  if (!draft.prepared || draft.prepared.profileId !== facts.profileId || draft.prepared.schemaEpoch !== facts.schemaEpoch) throw new AdmissionError('incompatible-schema');
  return draft.prepared;
}
