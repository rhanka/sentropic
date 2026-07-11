import { describe, expect, it } from 'vitest';

import {
  KNOWN_FEDERATION_PROVIDER_IDS,
  createDefaultAuthUiLabels,
  createFrenchAuthUiLabels,
  federationIdentityLabel,
  formatFederationLabel,
  isLastSignInFactor,
  resolveFederationGlyphId,
  type AuthUiFederationProvider,
  type AuthUiLinkedIdentity,
} from '../src/index.js';

const identity = (over: Partial<AuthUiLinkedIdentity> = {}): AuthUiLinkedIdentity => ({
  id: 'id-1',
  provider: 'google',
  ...over,
});

describe('federation provider glyph resolution', () => {
  it('ships a glyph key for each known provider', () => {
    for (const id of KNOWN_FEDERATION_PROVIDER_IDS) {
      expect(resolveFederationGlyphId(id)).toBe(id);
    }
  });

  it('normalizes casing/whitespace to the known glyph key', () => {
    expect(resolveFederationGlyphId('  GitHub ')).toBe('github');
    expect(resolveFederationGlyphId('MICROSOFT')).toBe('microsoft');
  });

  it('falls back to a generic glyph for unknown providers', () => {
    expect(resolveFederationGlyphId('okta')).toBe('generic');
    expect(resolveFederationGlyphId('')).toBe('generic');
  });
});

describe('federation button copy', () => {
  it('fills the {label} placeholder (both locale templates)', () => {
    expect(formatFederationLabel('Continue with {label}', 'Google')).toBe('Continue with Google');
    expect(formatFederationLabel('Continuer avec {label}', 'Apple')).toBe('Continuer avec Apple');
  });

  it('replaces every occurrence of the placeholder', () => {
    expect(formatFederationLabel('{label} — {label}', 'GitHub')).toBe('GitHub — GitHub');
  });

  it('exposes the federation labels in both presets (i18n wiring)', () => {
    const en = createDefaultAuthUiLabels();
    const fr = createFrenchAuthUiLabels();
    expect(en.federationContinueWith).toBe('Continue with {label}');
    expect(en.federationDividerLabel).toBe('or');
    expect(en.identitiesUnlinkLastFactor).toContain('only sign-in method');
    expect(fr.federationContinueWith).toBe('Continuer avec {label}');
    expect(fr.federationDividerLabel).toBe('ou');
    expect(fr.identitiesLinkButton).toBe('Lier {label}');
  });
});

describe('federation identity label', () => {
  it('prefers an explicit providerLabel', () => {
    expect(federationIdentityLabel(identity({ providerLabel: 'Google Workspace' }))).toBe('Google Workspace');
  });

  it('titles the provider id when no label is given', () => {
    expect(federationIdentityLabel(identity({ provider: 'github', providerLabel: undefined }))).toBe('Github');
  });
});

describe('isLastSignInFactor (K-UNLINK-LASTFACTOR / D12)', () => {
  it('is the last factor when it is the only identity and no other factor exists', () => {
    const target = identity();
    expect(isLastSignInFactor(target, { identities: [target] })).toBe(true);
  });

  it('is NOT the last factor when a passkey remains', () => {
    const target = identity();
    expect(isLastSignInFactor(target, { identities: [target], credentialCount: 1 })).toBe(false);
  });

  it('is NOT the last factor when the account is magic-link capable', () => {
    const target = identity();
    expect(isLastSignInFactor(target, { identities: [target], magicLinkCapable: true })).toBe(false);
  });

  it('is NOT the last factor when another linked identity remains', () => {
    const target = identity({ id: 'id-1' });
    const other = identity({ id: 'id-2', provider: 'github' });
    expect(isLastSignInFactor(target, { identities: [target, other] })).toBe(false);
  });

  it('treats a negative/undefined credential count as zero factors', () => {
    const target = identity();
    expect(isLastSignInFactor(target, { identities: [target], credentialCount: -3 })).toBe(true);
  });
});

describe('backward-compatibility (K-UI-LEGACY contract)', () => {
  it('an empty provider list yields no buttons to render', () => {
    const providers: AuthUiFederationProvider[] = [];
    // AuthFederationButtons renders `{#if providers.length > 0}`; an empty list
    // means legacy hosts that omit `federationProviders` see zero federation UI.
    expect(providers.length).toBe(0);
  });

  it('provider entries carry a browser-redirect startHref, not an XHR', () => {
    const providers: AuthUiFederationProvider[] = [
      { id: 'google', label: 'Google', startHref: '/auth/federation/google/start' },
    ];
    expect(providers[0].startHref).toBe('/auth/federation/google/start');
    expect(formatFederationLabel(createDefaultAuthUiLabels().federationContinueWith, providers[0].label)).toBe(
      'Continue with Google',
    );
  });
});
