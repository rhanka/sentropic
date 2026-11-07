/**
 * Generic host binding for persistent reader consent
 * (design-merged §4.1, §4.3). Thin host binding over the generic
 * ArtifactReaderStore, scoped to one storage scope per service instance: the
 * reader revokes only their own consents resolved from the verified session
 * (never a body field); a platform admin may revoke any reader's consent
 * (incident response, never grant); the artifact owner cannot revoke consent
 * — the owner's instrument is share revocation. Revoking for an unreadable
 * artifact reads `not_found`, never 403, so the existence oracle stays closed.
 */
import { assertConsentScopeId, decideGateB, type FreshRights, type GateBDecision } from './consent.js';
import type { ArtifactReaderStore } from './reader-store.js';

export { consentScreenPath, renderConsentScreen, type ConsentScreenParams } from './consent-screen.js';

/** Stable first-party grant refusal; hosts return this body with HTTP 403. */
export interface ReaderConsentRequired {
  code: 'reader_consent_required';
  scopeId: string;
  retryable: false;
}

export function readerConsentRequired(scopeId: string): ReaderConsentRequired {
  return { code: 'reader_consent_required', scopeId, retryable: false };
}

export interface ConsentGrantInput {
  readerAccountId: string;
  artifactId: string;
  scopeId: string;
  scopeVersion: string;
}

export interface ConsentRevokeInput {
  readerAccountId: string;
  artifactId: string;
  scopeId?: string;
}

export interface GateCheckInput {
  readerAccountId: string;
  artifactId: string;
  scopeId: string;
  scopeVersion: string;
  rights: FreshRights;
}

const denied = (code: 'not_found' | 'access_denied') => new Error(code);

export function createReaderConsentService(deps: {
  store: ArtifactReaderStore;
  storageScopeId: string;
  canReadArtifact: (artifactId: string, readerAccountId: string) => Promise<boolean>;
  isAdmin: (accountId: string) => Promise<boolean>;
  resolveTitle?: (artifactId: string) => Promise<string | undefined>;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const key = (input: ConsentRevokeInput) => ({ storageScopeId: deps.storageScopeId,
    readerAccountId: input.readerAccountId, artifactId: input.artifactId,
    ...(input.scopeId === undefined ? {} : { scopeId: input.scopeId }) });
  return {
    /**
     * First-party grant with a locked fresh-rights re-check: the host's
     * checkRights (immo getRights) runs immediately before the store write,
     * under the host's own authority discipline.
     */
    async grantWithFreshRights(input: ConsentGrantInput, checkRights: () => Promise<boolean>) {
      assertConsentScopeId(input.scopeId);
      if (!await checkRights()) throw denied('access_denied');
      return deps.store.grantConsent({ storageScopeId: deps.storageScopeId, ...input,
        consentId: crypto.randomUUID(), grantedAt: now(), grantedVia: 'reader_screen' });
    },
    /**
     * J1.3b — fresh-rights probe for the first-party grant route: the same
     * readability check the service was built with, so the grant route never
     * invents its own authority rule.
     */
    async checkReaderFreshRights(input: { readerAccountId: string; artifactId: string }) {
      return deps.canReadArtifact(input.artifactId, input.readerAccountId);
    },
    /**
     * J1.3b — Gate B for the generic reader gate route: live consent at the
     * host-declared version plus fresh rights, evaluated on this call.
     */
    async evaluateGate(input: GateCheckInput): Promise<GateBDecision> {
      assertConsentScopeId(input.scopeId);
      const consent = await deps.store.findLiveConsent({ storageScopeId: deps.storageScopeId,
        readerAccountId: input.readerAccountId, artifactId: input.artifactId,
        scopeId: input.scopeId, scopeVersion: input.scopeVersion });
      return decideGateB({ consent, currentScopeVersion: input.scopeVersion,
        rights: input.rights, scopeId: input.scopeId });
    },
    async listOwnConsents(readerAccountId: string) {
      const rows = await deps.store.listConsentsForReader(deps.storageScopeId, readerAccountId);
      const live = rows.filter((row) => row.revokedAt === undefined);
      return Promise.all(live.map(async (row) => ({ artifactId: row.artifactId,
        title: await deps.resolveTitle?.(row.artifactId) ?? row.artifactId,
        scopeId: row.scopeId, scopeVersion: row.scopeVersion, grantedAt: row.grantedAt })));
    },
    async revokeOwnConsent(input: ConsentRevokeInput) {
      if (input.scopeId !== undefined) assertConsentScopeId(input.scopeId);
      if (!await deps.canReadArtifact(input.artifactId, input.readerAccountId)) throw denied('not_found');
      const result = await deps.store.revokeAllConsents(key(input),
        'self', now(), { actor: input.readerAccountId, surface: 'api' });
      return { changed: result.changed, revokedAt: result.changed ? now() : null };
    },
    async revokeAllOwnConsents(input: Omit<ConsentRevokeInput, 'scopeId'>) {
      if (!await deps.canReadArtifact(input.artifactId, input.readerAccountId)) throw denied('not_found');
      const result = await deps.store.revokeAllConsents(key(input), 'self', now(),
        { actor: input.readerAccountId, surface: 'api' });
      return { changed: result.changed, revoked: result.revoked };
    },
    /**
     * Platform-admin incident revocation. The admin never grants (reduce-only,
     * mirroring canManageAccess); the artifact owner is refused here.
     */
    async adminRevokeConsent(input: ConsentRevokeInput, adminAccountId: string) {
      if (input.scopeId !== undefined) assertConsentScopeId(input.scopeId);
      if (!await deps.isAdmin(adminAccountId)) throw denied('access_denied');
      const result = await deps.store.revokeAllConsents(key(input),
        'admin', now(), { actor: adminAccountId, surface: 'api' });
      return { changed: result.changed, revokedAt: result.changed ? now() : null };
    },
  };
}

export type ReaderConsentService = ReturnType<typeof createReaderConsentService>;
