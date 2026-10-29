import type { AdmissionAuthority, AdmissionPorts } from './admission';
import type { OpenSessionInput, FieldBindingIdentity } from './contracts';
import type { DraftRecovery } from './recovery';
import type { SessionRegistry } from './session-registry';

export class LiveSessionProvider {
  constructor(private readonly authority: AdmissionAuthority, private readonly registry: SessionRegistry,
    private readonly recovery: DraftRecovery, private readonly ports: Pick<AdmissionPorts, 'authenticate' | 'document'> & {
      captureDraft(input: OpenSessionInput): Promise<{ draftId: string; bytes: Uint8Array }>;
    }) {}
  async openLiveSession(_input: OpenSessionInput): Promise<{ kind: 'live-session'; identity: FieldBindingIdentity; dispose(): Promise<void> }> { throw new Error('H1 live provider not implemented'); }
}
