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
