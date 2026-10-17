import { browserSupportsWebAuthn, startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

export interface EnrolledCredential {
  id: string;
  rpId: string;
  origins: string[];
  locallyEnrolled: boolean;
  awayUsable: boolean;
  revoked: boolean;
}
export interface PreparedProof {
  challengeId: string;
  expiresAt: number;
  options: PublicKeyCredentialRequestOptionsJSON;
}
export const canUseCredential = (keys: EnrolledCredential[], supported: boolean, origin: string) =>
  supported && keys.some((key) => key.locallyEnrolled && key.awayUsable && !key.revoked
    && Boolean(key.id && key.rpId) && key.origins.includes(origin));

export const browserKeyAvailable = (keys: EnrolledCredential[]) =>
  typeof window !== 'undefined' && canUseCredential(keys, browserSupportsWebAuthn(), window.location.origin);

export async function browserAssertion(prepared: PreparedProof, keys: EnrolledCredential[], signal: AbortSignal) {
  if (!browserKeyAvailable(keys) || signal.aborted) throw new Error('credential_unavailable');
  const remaining = prepared.expiresAt - Date.now();
  const options = prepared.options;
  const allowed = keys.filter((key) => key.locallyEnrolled && key.awayUsable && !key.revoked
    && key.rpId === options.rpId && key.origins.includes(window.location.origin));
  if (remaining <= 0 || remaining > 60000 || options.userVerification !== 'required'
    || !options.challenge || !options.allowCredentials?.length
    || options.allowCredentials.some((key) => !allowed.some((enrolled) => enrolled.id === key.id))) {
    throw new Error('invalid_source_challenge');
  }
  const abort = () => WebAuthnAbortService.cancelCeremony();
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await startAuthentication({ optionsJSON: { ...options, timeout: remaining } });
  } finally {
    signal.removeEventListener('abort', abort);
  }
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
  sourceAvailable: boolean; liveAuthorized: boolean; credentialUsable: boolean;
}
export type KeyboardOutcome = { status: 'submitted' | 'refused' | 'outcome_unknown' };
interface KeyboardPorts {
  prepareLease: (context: ControlContext) => Promise<PreparedProof>;
  acquire: (proof: PreparedProof, assertion: unknown) => Promise<{ controllerEpoch: number; expiresAt: number }>;
  prepare: (input: { context: ControlContext; idempotencyKey: string; bytesBase64: string; byteLength: number }) => Promise<PreparedProof>;
  prove: (proof: PreparedProof, signal: AbortSignal) => Promise<unknown>;
  submit: (input: { idempotencyKey: string; bytesBase64: string; proof: PreparedProof; assertion: unknown }, signal: AbortSignal) => Promise<KeyboardOutcome>;
  query: (key: string) => Promise<KeyboardOutcome>;
  newKey: () => string;
}
type PreparedAction = { proof: PreparedProof; key: string; bytesBase64: string; fingerprint: string };

/** One explicit preparation and browser gesture per action. There is no dispatch retry path. */
export class KeyboardFlow {
  text = ''; newline = false; lastKey = ''; previousUnknown = false;
  status: 'idle' | 'prepared' | KeyboardOutcome['status'] = 'idle';
  prepared: PreparedAction | null = null;
  lease: { controllerEpoch: number; expiresAt: number } | null = null;
  private revision = 0;
  private pending = false;
  private disposed = false;
  private abort = new AbortController();
  constructor(public context: ControlContext, private readonly ports: KeyboardPorts) {}
  get available() {
    return !this.disposed && this.context.sourceAvailable && this.context.liveAuthorized && this.context.credentialUsable;
  }
  get ready() {
    return this.available && !!this.lease && this.lease.expiresAt > Date.now()
      && this.lease.controllerEpoch === this.context.controllerEpoch;
  }
  private fingerprint() { return JSON.stringify([this.context, exactInput(this.text, this.newline).base64]); }
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
  async acquire() {
    if (!this.available || this.pending) return;
    const revision = this.revision; this.pending = true;
    try {
      const proof = await this.ports.prepareLease(structuredClone(this.context));
      if (revision !== this.revision || !this.available || proof.expiresAt <= Date.now()) return;
      const assertion = await this.ports.prove(proof, this.abort.signal);
      if (revision !== this.revision || !this.available || proof.expiresAt <= Date.now()) return;
      const lease = await this.ports.acquire(proof, assertion);
      if (revision === this.revision && this.available) this.lease = lease;
    } finally { if (revision === this.revision) this.pending = false; }
  }
  async prepare() {
    if (!this.ready || this.pending) return;
    const input = exactInput(this.text, this.newline);
    const revision = this.revision; const fingerprint = this.fingerprint();
    const key = this.ports.newKey(); this.pending = true; this.prepared = null;
    try {
      const proof = await this.ports.prepare({ context: structuredClone(this.context),
        idempotencyKey: key, bytesBase64: input.base64, byteLength: input.byteLength });
      if (revision === this.revision && this.ready && fingerprint === this.fingerprint()
        && proof.expiresAt > Date.now()) {
        this.prepared = { proof, key, bytesBase64: input.base64, fingerprint }; this.status = 'prepared';
      }
    } finally { if (revision === this.revision) this.pending = false; }
  }
  async send() {
    const prepared = this.prepared;
    if (!this.ready || this.pending || !prepared) return;
    if (prepared.proof.expiresAt <= Date.now() || prepared.fingerprint !== this.fingerprint()) { this.cancel(); return; }
    const revision = this.revision; this.pending = true; this.prepared = null;
    try {
      const assertion = await this.ports.prove(prepared.proof, this.abort.signal);
      if (revision !== this.revision || !this.ready || prepared.proof.expiresAt <= Date.now()
        || prepared.fingerprint !== this.fingerprint()) return;
      this.lastKey = prepared.key; this.status = 'outcome_unknown';
      try {
        const result = await this.ports.submit({ idempotencyKey: prepared.key,
          bytesBase64: prepared.bytesBase64, proof: prepared.proof, assertion }, this.abort.signal);
        if (revision === this.revision) this.status = result.status;
      } catch { /* Any lost response, including 429, leaves the effect unknown. */ }
      this.previousUnknown ||= this.status === 'outcome_unknown';
    } catch (error) {
      if (revision === this.revision) this.status = 'refused';
      throw error;
    } finally {
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
