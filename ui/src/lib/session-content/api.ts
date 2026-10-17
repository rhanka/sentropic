import { getApiAuthToken } from '@sentropic/cowork-bridge/core';
import { apiRequest } from '$lib/utils/api';
import type { ContentScope, NamedHistory, ProjectOffer, SessionView } from './state';
import { matchesConfirmation, proofExpiry, type AuthenticationState, type ConfirmationProof,
  type ControlContext, type KeyboardOutcome, type PreparedProof } from './proof';

const ROOT = '/auth/session/content';
const id = encodeURIComponent;
export interface RetainedHandle {
  retainedScopeId: string;
  bindingId: string;
  bytes: number;
  status: string;
}
export interface SessionsMetadata extends ContentScope {
  projectRevision?: number;
  projectState?: string;
  sourceVerified: boolean;
  authenticationState: AuthenticationState;
  confirmationAvailable: boolean;
  namedHistories: NamedHistory[];
  eligibleSources: { sessionId: string; sourceId: string }[];
  items: SessionView[];
  controls?: Record<string, ControlContext>;
  reason?: string;
}
export interface PreparedConsent extends PreparedProof { policyDigest: string }
export interface OutputPage {
  frames: { seq: number; text: string }[];
  gaps: { from: number; to: number; reason: string }[];
}

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  if (getApiAuthToken()) throw new Error('first_party_required');
  return apiRequest<T>(`${ROOT}${path}`, {
    method, cache: 'no-store', headers: { 'X-Session-Content': 'browser' }, ...(signal ? { signal } : {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const workspace = (workspaceId: string) => `/workspaces/${id(workspaceId)}`;
const binding = (bindingId: string) => `/${id(bindingId)}`;
async function outcome(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<KeyboardOutcome> {
  const result = await request<KeyboardOutcome>(path, method, body, signal);
  if (!['submitted', 'refused', 'outcome_unknown'].includes(result?.status)) throw new Error('unknown_outcome');
  return result;
}

export const contentApi = {
  metadata: (workspaceId: string) => request<SessionsMetadata>(`${workspace(workspaceId)}/sessions`),
  attach: (workspaceId: string, sessionId: string, sourceId: string) =>
    request(`${workspace(workspaceId)}/attachments`, 'POST', { sessionId, sourceId }),
  prepareOffer: (offer: ProjectOffer) =>
    request<PreparedConsent>(`${workspace(offer.workspaceId)}/consent/prepare`, 'POST', offer),
  acceptOffer: (offer: ProjectOffer, prepared: PreparedConsent, confirmation: ConfirmationProof) =>
    request(`${workspace(offer.workspaceId)}/consent`, 'POST', { ...offer,
      challengeId: prepared.native.challenge.id, policyDigest: prepared.policyDigest, confirmation }),
  retained: () => request<{ items: RetainedHandle[] }>('/retained-content'),
  purge: (handle: Pick<RetainedHandle, 'bindingId' | 'retainedScopeId'>) =>
    request<{ complete: boolean }>(`${binding(handle.bindingId)}/consent?retainedScopeId=${id(handle.retainedScopeId)}`, 'DELETE'),
  revoke: (bindingId: string) => request(`${binding(bindingId)}/consent`, 'DELETE'),
  revokeProject: (workspaceId: string) => request(`${workspace(workspaceId)}/consent`, 'DELETE'),
  exclude: (bindingId: string) => request(`${binding(bindingId)}/exclusion`, 'PUT', { excluded: true }),
  authorizeHistory: (bindingId: string) =>
    request(`${binding(bindingId)}/history-authorizations`, 'POST'),
  read: (bindingId: string, closed: boolean) =>
    request<OutputPage>(`${binding(bindingId)}/${closed ? 'history' : 'frames'}`),
  releaseKeyboard: (bindingId: string) => request(`${binding(bindingId)}/keyboard/lease`, 'DELETE'),
  keyboard(bindingId: string) {
    const path = `${binding(bindingId)}/keyboard`;
    return {
      prepareLease: (context: ControlContext, idempotencyKey: string) => request<PreparedProof>(`${path}/lease`, 'POST', { context, idempotencyKey }),
      acquire: (proof: PreparedProof, confirmation: ConfirmationProof, idempotencyKey: string) =>
        request<{ controllerEpoch: number; expiresAt: number }>(`${path}/lease`, 'POST', { challengeId: proof.native.challenge.id, confirmation, idempotencyKey }),
      prepare: (input: { context: ControlContext; idempotencyKey: string; bytesBase64: string; byteLength: number }) =>
        request<PreparedProof>(`${path}/prepare`, 'POST', input),
      submit: (input: { idempotencyKey: string; bytesBase64: string; proof: PreparedProof; confirmation: ConfirmationProof }, signal: AbortSignal) =>
        outcome(`${path}/submissions`, 'POST', { idempotencyKey: input.idempotencyKey,
          bytesBase64: input.bytesBase64, confirmation: input.confirmation }, signal),
      query: (key: string) => outcome(`${path}/submissions/${id(key)}`),
    };
  },
};

/** UI correlation only. CM2-N5-AUTH owns the configured callback/client policy;
 * native must verify the unchanged token before any scope expansion or effect. */
export async function browserStepUp(prepared: PreparedProof, signal: AbortSignal): Promise<ConfirmationProof> {
  const refuse = () => new Error('confirmation_refused');
  if (getApiAuthToken() || signal.aborted) throw refuse();
  const { native, authorization } = prepared;
  const url = new URL(authorization.url);
  const params = url.searchParams;
  const allowed = ['client_id', 'response_type', 'redirect_uri', 'scope', 'state', 'nonce',
    'code_challenge', 'code_challenge_method', 'prompt'];
  const digest = native.challengeDigest;
  if (!/^[a-f0-9]{64}$/.test(digest)) throw refuse();
  const nonce = btoa(String.fromCharCode(...digest.match(/../g)!.map((byte) => parseInt(byte, 16))))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const remaining = proofExpiry(prepared) - Date.now();
  if (remaining <= 0 || remaining > 60000 || url.protocol !== 'https:' || url.hash || url.username || url.password
    || url.origin !== new URL(native.challenge.owner.issuer).origin
    || [...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1)
    || params.get('client_id') !== native.challenge.clientId || params.get('response_type') !== 'code'
    || params.get('prompt') !== 'login' || params.get('code_challenge_method') !== 'S256'
    || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '')
    || !/^[A-Za-z0-9_-]{43,128}$/.test(authorization.state) || params.get('state') !== authorization.state
    || params.get('nonce') !== nonce || params.get('scope') !== 'openid'
    || new URL(params.get('redirect_uri') ?? '').origin !== window.location.origin) throw refuse();
  const popup = window.open(url.toString(), '_blank', 'popup,width=520,height=720');
  if (!popup) throw refuse();
  return new Promise((resolve, reject) => {
    const finish = (proof?: ConfirmationProof, error = refuse()) => {
      clearTimeout(expiry); clearInterval(closed);
      window.removeEventListener('message', returned); signal.removeEventListener('abort', abort);
      popup.close();
      if (proof) resolve(proof); else reject(error);
    };
    const abort = () => finish();
    const returned = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup
        || event.data?.type !== 'session-content-confirmation') return;
      if (event.data.state !== authorization.state || signal.aborted || proofExpiry(prepared) <= Date.now()) return finish();
      if (['authentication_required', 'step_up_required', 'confirmation_refused', 'source_unavailable'].includes(event.data.error)) {
        return finish(undefined, new Error(event.data.error));
      }
      if (!matchesConfirmation(prepared, event.data.proof)) return finish();
      finish(event.data.proof);
    };
    const expiry = setTimeout(abort, remaining);
    const closed = setInterval(() => { if (popup.closed) abort(); }, 250);
    window.addEventListener('message', returned); signal.addEventListener('abort', abort, { once: true });
  });
}
