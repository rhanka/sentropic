import type { Principal, DocumentFacts } from './admission';
import { admissionKey } from './admission';
import { AdmissionError } from './contracts';
export interface PreservedDraft {
  bytes: Uint8Array; profileId: string; schemaEpoch: string;
  discarded?: boolean;
  prepared?: { branch: 'client-upgrade' | 'draft-migration'; profileId: string; schemaEpoch: string; bytes: Uint8Array; acknowledged: boolean };
}
export interface RecoveryPorts {
  update(key: string, change: (old?: PreservedDraft) => PreservedDraft): Promise<PreservedDraft>;
  migrate(bytes: Uint8Array, from: Pick<PreservedDraft, 'profileId' | 'schemaEpoch'>, to: DocumentFacts): Promise<Uint8Array>;
  /** Read/set, or atomically clear only the expected id when draftId is null. */
  pending(key: string, draftId?: string | null, expected?: string): Promise<string | null>;
}
export class DraftRecovery {
  constructor(private readonly ports: RecoveryPorts) {}
  async preserve(principal: Principal, documentId: string, id: string, draft: PreservedDraft): Promise<PreservedDraft> {
    const saved = await this.ports.update(this.key(principal, documentId, id), (old) => {
      if (old && (old.discarded || old.profileId !== draft.profileId || old.schemaEpoch !== draft.schemaEpoch
        || old.bytes.length !== draft.bytes.length || !old.bytes.every((byte, index) => byte === draft.bytes[index]))) throw new AdmissionError('draft-id-reuse', id);
      return old ?? { bytes: draft.bytes.slice(), profileId: draft.profileId, schemaEpoch: draft.schemaEpoch };
    });
    await this.ports.pending(admissionKey(principal, documentId), id);
    return saved;
  }
  async requirePendingAcknowledged(principal: Principal, facts: DocumentFacts): Promise<void> {
    const id = await this.ports.pending(admissionKey(principal, facts.documentId));
    if (id) await this.requireAcknowledged(principal, facts, id);
  }
  async consumePendingAcknowledged(principal: Principal, facts: DocumentFacts): Promise<void> {
    const key = admissionKey(principal, facts.documentId); const id = await this.ports.pending(key);
    if (!id) return;
    await this.requireAcknowledged(principal, facts, id);
    if (await this.ports.pending(key, null, id)) throw new AdmissionError('incompatible-schema');
  }
  async discard(principal: Principal, facts: DocumentFacts, id: string): Promise<void> {
    await this.ports.update(this.key(principal, facts.documentId, id), (old) => ({
      ...requireDraft(old), bytes: new Uint8Array(), discarded: true,
      prepared: { branch: 'client-upgrade', profileId: facts.profileId, schemaEpoch: facts.schemaEpoch, bytes: new Uint8Array(), acknowledged: true },
    }));
    // Discarding an older capture must never clear a newer pending capture.
    await this.ports.pending(admissionKey(principal, facts.documentId), null, id);
  }
  async prepare(principal: Principal, facts: DocumentFacts, id: string, branch: 'client-upgrade' | 'draft-migration'): Promise<PreservedDraft> {
    if (branch !== 'client-upgrade' && branch !== 'draft-migration') throw new AdmissionError('incompatible-schema');
    const key = this.key(principal, facts.documentId, id);
    const draft = await this.ports.update(key, requireDraft);
    if (draft.discarded) throw new AdmissionError('incompatible-schema');
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
