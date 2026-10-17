/** Native wire v2 messages; the application relays the IdP proof unchanged. */
export interface ConfirmationChallenge {
  id: string;
  owner: { issuer: string; subject: string };
  project: { tenantId: string; workspaceId: string; workspaceIncarnation: string; projectId: string | null };
  source: { workstationId: string; bindingId: string; bindingVersion: number; sourceId: string;
    sourceGeneration: string; sourceBootId: string };
  clientId: string;
  purpose: 'share' | 'amend' | 'remote-action';
  target: { kind: 'policy'; policyDigest: string } | { kind: 'action'; scopeDigest: string;
    operation: string; operationId: string; connectionId: string; controllerEpoch: number;
    byteLength: number; payloadHash: string };
  random: string; issuedAt: number; expiresAt: number;
}
export interface PreparedProof {
  native: { protocol: 'h2a.session-content'; protocolVersion: 2; kind: 'confirmation-challenge';
    challenge: ConfirmationChallenge; challengeDigest: string };
  authorization: { url: string; state: string };
}
export interface ConfirmationProof { challengeId: string; challengeDigest: string; idToken: string }
export type AuthenticationState = 'authentication_required' | 'step_up_required';
export const proofExpiry = (proof: PreparedProof) => proof.native.challenge.expiresAt;
export function matchesConfirmation(proof: PreparedProof, returned: ConfirmationProof) {
  return returned?.challengeId === proof.native.challenge.id
    && returned.challengeDigest === proof.native.challengeDigest
    && typeof returned.idToken === 'string' && returned.idToken.length > 0 && returned.idToken.length <= 16384;
}
export function exactInput(text: string, newline: boolean) {
  const value = text + (newline ? '\n' : '');
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) throw new Error('invalid_utf8');
  }
  const bytes = new TextEncoder().encode(value);
  if (!bytes.length || bytes.length > 4096) throw new Error('input_size');
  return { text: value, byteLength: bytes.length, preview: JSON.stringify(value),
    base64: btoa(String.fromCharCode(...bytes)) };
}

export interface ControlContext {
  bindingId: string; bindingVersion: number; sourceGeneration: string; incarnation: string;
  projectRevision: number; ownerId: string; workspaceId: string; controllerEpoch: number;
  sourceAvailable: boolean; liveAuthorized: boolean; authenticationState: AuthenticationState; confirmationAvailable: boolean;
}
export type KeyboardOutcome = { status: 'submitted' | 'refused' | 'outcome_unknown' };
interface KeyboardPorts {
  prepareLease: (context: ControlContext, idempotencyKey: string) => Promise<PreparedProof>;
  acquire: (proof: PreparedProof, confirmation: ConfirmationProof, idempotencyKey: string) => Promise<{ controllerEpoch: number; expiresAt: number }>;
  prepare: (input: { context: ControlContext; idempotencyKey: string; bytesBase64: string; byteLength: number }) => Promise<PreparedProof>;
  prove: (proof: PreparedProof, signal: AbortSignal) => Promise<ConfirmationProof>;
  submit: (input: { idempotencyKey: string; bytesBase64: string; proof: PreparedProof; confirmation: ConfirmationProof }, signal: AbortSignal) => Promise<KeyboardOutcome>;
  query: (key: string) => Promise<KeyboardOutcome>;
  newKey: () => string;
}
type PreparedAction = { kind: 'acquire' | 'input'; proof: PreparedProof; confirmation: ConfirmationProof;
  key: string; bytesBase64: string; fingerprint: string };

/** Each preparation requires a fresh IdP return, then a separate explicit submission. */
export class KeyboardFlow {
  text = ''; newline = false; lastKey = ''; previousUnknown = false;
  status: 'idle' | 'step_up_required' | 'confirmation_returned' | 'authentication_required' | 'confirmation_refused' | 'source_unavailable' | KeyboardOutcome['status'] = 'idle';
  prepared: PreparedAction | null = null;
  lease: { controllerEpoch: number; expiresAt: number } | null = null;
  private revision = 0;
  private pending = false;
  private disposed = false;
  private abort = new AbortController();
  constructor(public context: ControlContext, private readonly ports: KeyboardPorts) {}
  get available() {
    return !this.disposed && this.context.sourceAvailable && this.context.liveAuthorized
      && this.context.authenticationState === 'step_up_required' && this.context.confirmationAvailable;
  }
  get ready() {
    return this.available && !!this.lease && this.lease.expiresAt > Date.now()
      && this.lease.controllerEpoch === this.context.controllerEpoch;
  }
  private fingerprint(kind: 'acquire' | 'input') {
    return JSON.stringify([this.context, kind === 'input' ? exactInput(this.text, this.newline).base64 : null]);
  }
  private refusal(error: unknown) {
    const code = error instanceof Error ? error.message : '';
    this.status = code === 'authentication_required' || code === 'step_up_required' || code === 'source_unavailable'
      ? code : 'confirmation_refused';
  }
  cancel() {
    this.revision++; this.abort.abort(); this.abort = new AbortController();
    this.prepared = null; this.pending = false; this.text = ''; this.newline = false;
    if (this.status !== 'outcome_unknown') this.status = 'idle';
  }
  edit(text: string, newline: boolean) { this.cancel(); this.text = text; this.newline = newline; }
  setContext(context: ControlContext) {
    if (JSON.stringify(context) === JSON.stringify(this.context)) return;
    this.cancel(); this.context = structuredClone(context); this.lease = null; this.lastKey = '';
  }
  dispose() { this.cancel(); this.disposed = true; this.lease = null; this.lastKey = ''; }
  async acquire() { await this.prepareConfirmation('acquire'); }
  async prepare() { await this.prepareConfirmation('input'); }
  private async prepareConfirmation(kind: 'acquire' | 'input') {
    if (!this.available || this.pending || (kind === 'input' && !this.ready)) return;
    const bytes = kind === 'input' ? exactInput(this.text, this.newline) : { base64: '', byteLength: 0 };
    const revision = this.revision; const fingerprint = this.fingerprint(kind);
    const key = this.ports.newKey(); this.pending = true; this.prepared = null;
    this.status = 'step_up_required';
    try {
      const proof = kind === 'acquire' ? await this.ports.prepareLease(structuredClone(this.context), key)
        : await this.ports.prepare({ context: structuredClone(this.context), idempotencyKey: key,
          bytesBase64: bytes.base64, byteLength: bytes.byteLength });
      const valid = () => revision === this.revision && this.available
        && (kind === 'acquire' || this.ready) && fingerprint === this.fingerprint(kind);
      if (!valid()) return;
      if (proof.native.protocol !== 'h2a.session-content' || proof.native.protocolVersion !== 2
        || proof.native.kind !== 'confirmation-challenge' || proof.native.challenge.purpose !== 'remote-action'
        || !Number.isSafeInteger(proof.native.challenge.issuedAt) || !Number.isSafeInteger(proofExpiry(proof))
        || proofExpiry(proof) <= Date.now() || proofExpiry(proof) - proof.native.challenge.issuedAt > 60000) {
        throw new Error('confirmation_refused');
      }
      const confirmation = await this.ports.prove(proof, this.abort.signal);
      if (!valid()) return;
      if (proofExpiry(proof) <= Date.now() || !matchesConfirmation(proof, confirmation)) throw new Error('confirmation_refused');
      this.prepared = { kind, proof, confirmation, key, bytesBase64: bytes.base64, fingerprint };
      this.status = 'confirmation_returned';
    } catch (error) {
      if (revision === this.revision) this.refusal(error);
      throw error;
    } finally { if (revision === this.revision) this.pending = false; }
  }
  async send() {
    const prepared = this.prepared;
    if (!this.available || this.pending || !prepared || (prepared.kind === 'input' && !this.ready)) return;
    if (proofExpiry(prepared.proof) <= Date.now()
      || prepared.fingerprint !== this.fingerprint(prepared.kind)) { this.cancel(); return; }
    const revision = this.revision; this.pending = true; this.prepared = null;
    this.lastKey = prepared.key; this.status = 'outcome_unknown';
    try {
      if (prepared.kind === 'acquire') {
        const lease = await this.ports.acquire(prepared.proof, prepared.confirmation, prepared.key);
        if (revision === this.revision && this.available) { this.lease = lease; this.status = 'submitted'; }
      } else {
        const result = await this.ports.submit({ idempotencyKey: prepared.key,
          bytesBase64: prepared.bytesBase64, proof: prepared.proof, confirmation: prepared.confirmation }, this.abort.signal);
        if (revision === this.revision) this.status = result.status;
      }
    } catch { /* A lost response, including 429, never permits redispatch. */ }
    finally {
      this.previousUnknown ||= this.status === 'outcome_unknown';
      if (revision === this.revision) { this.text = ''; this.newline = false; this.pending = false; }
    }
  }
  async reconcile() {
    if (!this.lastKey || !this.available || this.pending) return;
    const key = this.lastKey;
    const outcome = await this.ports.query(key);
    if (key === this.lastKey && !this.disposed) this.status = outcome.status;
  }
}
