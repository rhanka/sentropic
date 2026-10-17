import { getApiAuthToken } from '@sentropic/cowork-bridge/core';
import { apiRequest } from '$lib/utils/api';
import type { ContentScope, NamedHistory, ProjectOffer, SessionView } from './state';
import type { ControlContext, EnrolledCredential, KeyboardOutcome, PreparedProof } from './proof';

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
  credentials: EnrolledCredential[];
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
  acceptOffer: (offer: ProjectOffer, prepared: PreparedConsent, assertion: unknown) =>
    request(`${workspace(offer.workspaceId)}/consent`, 'POST', { ...offer,
      challengeId: prepared.challengeId, policyDigest: prepared.policyDigest, assertion }),
  retained: () => request<{ items: RetainedHandle[] }>('/retained-content'),
  purge: (handle: Pick<RetainedHandle, 'bindingId' | 'retainedScopeId'>) =>
    request<{ complete: boolean }>(`${binding(handle.bindingId)}/consent?retainedScopeId=${id(handle.retainedScopeId)}`, 'DELETE'),
  revoke: (bindingId: string) => request(`${binding(bindingId)}/consent`, 'DELETE'),
  revokeProject: (workspaceId: string) => request(`${workspace(workspaceId)}/consent`, 'DELETE'),
  exclude: (bindingId: string) => request(`${binding(bindingId)}/exclusion`, 'PUT', { excluded: true }),
  prepareHistory: (bindingId: string) =>
    request<PreparedProof>(`${binding(bindingId)}/history-authorizations/prepare`, 'POST'),
  authorizeHistory: (bindingId: string, proof: PreparedProof, assertion: unknown) =>
    request(`${binding(bindingId)}/history-authorizations`, 'POST', { challengeId: proof.challengeId, assertion }),
  read: (bindingId: string, closed: boolean) =>
    request<OutputPage>(`${binding(bindingId)}/${closed ? 'history' : 'frames'}`),
  releaseKeyboard: (bindingId: string) => request(`${binding(bindingId)}/keyboard/lease`, 'DELETE'),
  keyboard(bindingId: string) {
    const path = `${binding(bindingId)}/keyboard`;
    return {
      prepareLease: (context: ControlContext) => request<PreparedProof>(`${path}/lease`, 'POST', { context }),
      acquire: (proof: PreparedProof, assertion: unknown) =>
        request<{ controllerEpoch: number; expiresAt: number }>(`${path}/lease`, 'POST', { challengeId: proof.challengeId, assertion }),
      prepare: (input: { context: ControlContext; idempotencyKey: string; bytesBase64: string; byteLength: number }) =>
        request<PreparedProof>(`${path}/prepare`, 'POST', input),
      submit: (input: { idempotencyKey: string; bytesBase64: string; proof: PreparedProof; assertion: unknown }, signal: AbortSignal) =>
        outcome(`${path}/submissions`, 'POST', input, signal),
      query: (key: string) => outcome(`${path}/submissions/${id(key)}`),
    };
  },
};
