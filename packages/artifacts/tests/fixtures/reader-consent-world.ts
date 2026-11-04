/**
 * Lot 1a — shared reader-consent world for the consent acceptance tests
 * (design-merged §3.1, §3.2, §4.1). Internal account ids stay distinct from
 * anything projected so a leak of the internal form is observable.
 */
import { randomUUID } from 'node:crypto';
import { RADAR_ARTIFACTS_PROFILE, type ArtifactProviderProfile } from '../../src/profile/index.js';
import type { ArtifactReaderStore } from '../../src/server/reader-store.js';
import type { ConsentKey, ReaderConsentRecord } from '../../src/server/consent.js';
import { createMemoryReaderConsentStore } from '../../src/server/reader-store.js';
import { createTransportWorld } from './transport-world.js';

export const RC_SCOPE = 'scope-rc';
export const RC_OWNER = 'idp-sub-owner';
export const RC_ALICE = 'idp-sub-alice';
export const RC_BOB = 'idp-sub-bob';
export const RC_SCOPE_ID = 'baskets.read';
export const RC_SCOPE_VERSION = 'v1';

/** Radar profile with the single new consent tool selected (frozen four-tool vector otherwise untouched). */
export const rcProfile = (): ArtifactProviderProfile => ({
  ...RADAR_ARTIFACTS_PROFILE,
  selectedCapabilities: [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities,
    'artifacts_set_access', 'artifacts_revoke_reader_consent'],
  operations: [...RADAR_ARTIFACTS_PROFILE.operations,
    // revoke_reader_consent ships in the radar operations since lot 1a; set_access stays test-only (G2 owns it).
    { operation: 'set_access', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} }],
});

export interface RcWorld {
  world: ReturnType<typeof createTransportWorld>;
  store: ArtifactReaderStore;
  artifactId: string;
  grant(input?: Partial<ConsentKey & { consentId?: string; grantedAt?: string }>): Promise<ReaderConsentRecord>;
  grantRead(principalId: string): Promise<void>;
  revokeHttp(actor: string, body: Record<string, unknown>): Promise<{ status: number; body: any }>;
  revokeMcp(actor: string, args: Record<string, unknown>): Promise<{ status: number; body: any }>;
  setApproved(internalId: string, value: boolean): void;
}

export async function rcWorldWith(actors = [RC_OWNER, RC_ALICE, RC_BOB]): Promise<RcWorld> {
  const store = createMemoryReaderConsentStore();
  const world = createTransportWorld(actors, RC_SCOPE, { profile: rcProfile(), readerConsent: store });
  const ensured = await world.http('/ensure', { bindingName: 'page', idempotencyKey: 'ensure' });
  if (!ensured.ok) throw new Error('ensure failed');
  const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
  const call = (method: string, path: string, body: unknown, actor: string) => world.app.handle({
    method, path, body, actorId: actor,
  }, world.invocation(actor));
  return {
    world, store, artifactId,
    grant: async (input = {}) => {
      const record: ReaderConsentRecord = {
        consentId: input.consentId ?? randomUUID(),
        storageScopeId: input.storageScopeId ?? RC_SCOPE,
        readerAccountId: input.readerAccountId ?? RC_ALICE,
        artifactId: input.artifactId ?? artifactId,
        scopeId: input.scopeId ?? RC_SCOPE_ID,
        scopeVersion: input.scopeVersion ?? RC_SCOPE_VERSION,
        grantedAt: input.grantedAt ?? '2026-11-04T08:00:00.000Z',
        grantedVia: 'reader_screen',
      };
      return store.grantConsent(record);
    },
    grantRead: async (principalId) => {
      const res = await call('POST', '/set_access', { artifactId, action: 'grant',
        grant: 'read', principalId, idempotencyKey: `grant-${principalId}` }, RC_OWNER);
      if (res.status !== 200) throw new Error(`set_access failed: ${res.status}`);
    },
    revokeHttp: (actor, body) => call('POST', '/revoke_reader_consent', { artifactId, ...body }, actor),
    revokeMcp: async (actor, args) => {
      const outcome = await world.mcp.execute({ tool: 'artifacts_revoke_reader_consent',
        invocation: world.invocation(actor), args: { artifactId, ...args } });
      if (!outcome.ok) return { status: outcome.failure.httpStatus ?? 500, body: { error: outcome.failure.publicCode } };
      const response = outcome.result as { status: number; body: unknown };
      return { status: response.status, body: response.body };
    },
    setApproved: (internalId, value) => { world.setAccountApproved(internalId, value); },
  };
}
