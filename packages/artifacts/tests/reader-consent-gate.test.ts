/**
 * Lot 1a — Gate B decision table (design-merged §3.2, all 8 rows, consent
 * slice): a valid live consent never substitutes fresh rights, dormancy
 * resumes on reactivation or re-share, and deletion refuses everything.
 */
import { describe, expect, it } from 'vitest';
import { decideGateB, type FreshRights, type ReaderConsentRecord } from '../src/server/consent.js';
import { createMemoryReaderConsentStore } from '../src/server/reader-store.js';
import { RC_ALICE, RC_SCOPE, RC_SCOPE_ID, RC_SCOPE_VERSION } from './fixtures/reader-consent-world.js';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const live = (): ReaderConsentRecord => ({ consentId: 'c-live', storageScopeId: RC_SCOPE,
  readerAccountId: RC_ALICE, artifactId: ARTIFACT, scopeId: RC_SCOPE_ID,
  scopeVersion: RC_SCOPE_VERSION, grantedAt: '2026-11-04T08:00:00.000Z', grantedVia: 'reader_screen' });
const decide = (consent: ReaderConsentRecord | undefined, rights: FreshRights) =>
  decideGateB({ consent, currentScopeVersion: RC_SCOPE_VERSION, rights, scopeId: RC_SCOPE_ID });

describe('Gate B decision table', () => {
  it('executes with a live consent at the current version and fresh rights, without a screen', () => {
    expect(decide(live(), 'ok')).toEqual({ allowed: true });
  });

  it('refuses on a suspended account despite consent and resumes on reactivation', async () => {
    expect(decide(live(), 'suspended')).toEqual({ allowed: false, refusal: 'refused', status: 401 });
    // the row stays dormant: no revoke happened, rights recovery re-allows without a screen
    const store = createMemoryReaderConsentStore();
    await store.grantConsent(live());
    expect(decide(await store.findLiveConsent({ storageScopeId: RC_SCOPE, readerAccountId: RC_ALICE,
      artifactId: ARTIFACT, scopeId: RC_SCOPE_ID, scopeVersion: RC_SCOPE_VERSION }), 'ok'))
      .toEqual({ allowed: true });
  });

  it('refuses a withdrawn share despite consent and reuses consent on re-share', () => {
    expect(decide(live(), 'withdrawn')).toEqual({ allowed: false, refusal: 'refused', status: 404 });
    expect(decide(live(), 'ok')).toEqual({ allowed: true });
  });

  it('asks for consent when absent with passing rights and refuses without showing a screen otherwise', () => {
    expect(decide(undefined, 'ok')).toEqual({ allowed: false, refusal: 'reader_consent_required', scopeId: RC_SCOPE_ID });
    expect(decide(undefined, 'suspended')).toEqual({ allowed: false, refusal: 'refused', status: 401 });
    expect(decide(undefined, 'withdrawn')).toEqual({ allowed: false, refusal: 'refused', status: 404 });
  });

  it('asks again after revocation and on a stale version, keeping the old row for audit', async () => {
    const store = createMemoryReaderConsentStore();
    await store.grantConsent(live());
    await store.revokeConsent({ storageScopeId: RC_SCOPE, readerAccountId: RC_ALICE, artifactId: ARTIFACT,
      scopeId: RC_SCOPE_ID, scopeVersion: RC_SCOPE_VERSION }, 'self', '2026-11-04T09:00:00.000Z',
      { actor: RC_ALICE, surface: 'api' });
    expect(decide(await store.findLiveConsent({ storageScopeId: RC_SCOPE, readerAccountId: RC_ALICE,
      artifactId: ARTIFACT, scopeId: RC_SCOPE_ID, scopeVersion: RC_SCOPE_VERSION }), 'ok'))
      .toEqual({ allowed: false, refusal: 'reader_consent_required', scopeId: RC_SCOPE_ID });
    expect(decide(live(), 'gone')).toEqual({ allowed: false, refusal: 'refused', status: 404 });
    const stale = { ...live(), scopeVersion: 'v0' };
    expect(decide(stale, 'ok')).toEqual({ allowed: false, refusal: 'reader_consent_required', scopeId: RC_SCOPE_ID });
  });
});
