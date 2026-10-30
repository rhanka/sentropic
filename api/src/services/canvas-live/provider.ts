import type { AdmissionAuthority, AdmissionPorts, AdmissionRecord, Principal } from './admission';
import { admissionKey } from './admission';
import type { OpenSessionInput, FieldBindingIdentity } from './contracts';
import { AdmissionError } from './contracts';
import type { DraftRecovery } from './recovery';
import type { SessionRegistry, RegistryActor } from './session-registry';
interface LocalAdmission { record: AdmissionRecord; count: number; revoked: boolean; denied?: boolean }

export class LiveSessionProvider {
  private readonly bindings = new Map<string, LocalAdmission>();
  constructor(private readonly authority: AdmissionAuthority, private readonly registry: SessionRegistry,
    private readonly recovery: DraftRecovery, private readonly ports: Pick<AdmissionPorts, 'authenticate' | 'document'> & {
      /** An immutable capture id: changed bytes or source schema require a new id. */
      captureDraft(input: OpenSessionInput): Promise<{ draftId: string; bytes: Uint8Array }>;
    }) { authority.onClosed((record) => this.invalidate(record)); }
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
        throw new AdmissionError('incompatible-schema', draft.draftId);
      }
      throw error;
    }
    await this.recovery.requirePendingAcknowledged(record, record);
    record = await this.authority.check(record, input.binding.fieldKey, 'read');
    await this.recovery.consumePendingAcknowledged(record, record);
    const handle = this.registry.open(record, input.binding.fieldKey);
    const key = this.key(record, handle.identity);
    const existing = this.bindings.get(key);
    const entry = existing && !existing.revoked && !existing.denied && existing.record.sessionEpoch === record.sessionEpoch
      ? existing : { record, count: 0, revoked: false };
    this.bindings.set(key, entry); ++entry.count;
    let disposed = false;
    return { kind: handle.kind, identity: handle.identity, dispose: async () => {
      if (disposed) return; disposed = true;
      await handle.dispose();
      if (--entry.count === 0 && this.bindings.get(key) === entry) this.bindings.delete(key);
    } };
  }
  async resolveBinding(identity: FieldBindingIdentity) {
    return this.registry.resolveBinding(await this.checked(identity, 'read'), identity);
  }
  async authorizeBinding(identity: FieldBindingIdentity, operation: string): Promise<void> {
    await this.checked(identity, operation);
  }
  async subscribeActors(identity: FieldBindingIdentity, callback: (actors: RegistryActor[]) => void) {
    return this.registry.subscribeActors(await this.checked(identity, 'read'), callback, identity.fieldKey);
  }
  async closeLiveSession(identity: FieldBindingIdentity): Promise<void> {
    const principal = await this.ports.authenticate();
    const entry = this.bindings.get(this.key(principal, identity));
    if (!entry) throw new AdmissionError('invalid-binding');
    await this.authority.close(entry.record);
  }
  async prepareDraftRecovery(input: OpenSessionInput, draftId: string, branch: 'client-upgrade' | 'draft-migration') {
    const record = await this.authority.open(input);
    return this.recovery.prepare(record, record, draftId, branch);
  }
  async acknowledgeDraftRecovery(input: OpenSessionInput, draftId: string) {
    const record = await this.authority.open(input);
    await this.recovery.acknowledge(record, record, draftId);
  }
  async discardDraftRecovery(input: OpenSessionInput, draftId: string) {
    const record = await this.authority.open(input);
    await this.recovery.discard(record, record, draftId);
  }
  private key(principal: Principal, identity: FieldBindingIdentity) {
    return JSON.stringify([admissionKey(principal, identity.documentId), identity.sessionId, identity.fieldKey]);
  }
  private async checked(identity: FieldBindingIdentity, operation: string) {
    const principal = await this.ports.authenticate();
    const entry = this.bindings.get(this.key(principal, identity));
    if (!entry) throw new AdmissionError('invalid-binding');
    if (entry.revoked) throw new AdmissionError('revoked');
    try {
      const current = await this.authority.check(entry.record, identity.fieldKey, operation);
      if (entry.denied) throw new AdmissionError('scope-denied');
      return current;
    }
    catch (error) {
      if (error instanceof AdmissionError && error.code === 'revoked') this.invalidate(entry.record);
      else if (operation === 'read' && error instanceof AdmissionError && error.code === 'scope-denied') {
        this.registry.releaseField(entry.record, identity.fieldKey); entry.denied = true;
      }
      throw error;
    }
  }
  private invalidate(record: AdmissionRecord) {
    this.registry.revoke(record);
    for (const entry of this.bindings.values()) if (admissionKey(entry.record, entry.record.documentId) === admissionKey(record, record.documentId)
      && entry.record.sessionEpoch === record.sessionEpoch && entry.record.sessionId === record.sessionId) entry.revoked = true;
  }
}
