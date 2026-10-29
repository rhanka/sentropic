import type { AdmissionAuthority, AdmissionPorts } from './admission';
import type { OpenSessionInput } from './contracts';
import { AdmissionError } from './contracts';
import type { DraftRecovery } from './recovery';
import type { SessionRegistry } from './session-registry';

export class LiveSessionProvider {
  constructor(private readonly authority: AdmissionAuthority, private readonly registry: SessionRegistry,
    private readonly recovery: DraftRecovery, private readonly ports: Pick<AdmissionPorts, 'authenticate' | 'document'> & {
      captureDraft(input: OpenSessionInput): Promise<{ draftId: string; bytes: Uint8Array }>;
    }) {}
  async openLiveSession(input: OpenSessionInput) {
    let record;
    try {
      record = await this.authority.open(input);
    } catch (error) {
      if (error instanceof AdmissionError && error.code === 'incompatible-schema') {
        const principal = await this.ports.authenticate();
        if (principal.actor.actorId !== input.actor.actorId || principal.actor.kind !== input.actor.kind) throw new AdmissionError('actor-denied');
        const draft = await this.ports.captureDraft(structuredClone(input));
        await this.recovery.preserve(principal, input.binding.documentId, draft.draftId, {
          bytes: draft.bytes, profileId: input.profileId, schemaEpoch: input.schemaEpoch,
        });
      }
      throw error;
    }
    await this.recovery.requirePendingAcknowledged(record, record);
    return this.registry.open(record, input.binding.fieldKey);
  }
  async prepareDraftRecovery(input: OpenSessionInput, draftId: string, branch: 'client-upgrade' | 'draft-migration') {
    const record = await this.authority.open(input);
    return this.recovery.prepare(record, record, draftId, branch);
  }
  async acknowledgeDraftRecovery(input: OpenSessionInput, draftId: string) {
    const record = await this.authority.open(input);
    await this.recovery.acknowledge(record, record, draftId);
  }
}
