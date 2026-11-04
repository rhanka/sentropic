/**
 * Lot 1a — sentropic api binding for persistent reader consent
 * (design-merged §4.1, §4.3). Thin host binding over the generic
 * ArtifactReaderStore, scoped to one storage scope per service instance: the
 * reader revokes only their own consents resolved from the verified session
 * (never a body field); a platform admin may revoke any reader's consent
 * (incident response, never grant); the artifact owner cannot revoke consent
 * — the owner's instrument is share revocation. Revoking for an unreadable
 * artifact reads `not_found`, never 403, so the existence oracle stays closed.
 */
import { assertConsentScopeId } from '@sentropic/artifacts/server/consent';
import type { ArtifactReaderStore } from '@sentropic/artifacts/server/reader-store';

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
