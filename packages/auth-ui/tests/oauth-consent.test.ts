import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultOAuthConsentLabels,
  createFrenchOAuthConsentLabels,
  type OAuthConsentTransport,
} from '../src/index.js';

describe('OAuth consent contracts', () => {
  it('defines a dedicated transport for consent details and decisions', async () => {
    const transport: OAuthConsentTransport = {
      getConsent: vi.fn(async () => ({
        clientName: 'Example RP',
        redirectUri: 'http://localhost:5397/callback',
        scopes: ['openid', 'profile', 'email'],
      })),
      submitConsentDecision: vi.fn(async () => ({
        redirectTo: 'http://localhost:5397/callback?code=code-1&state=state-1',
      })),
    };

    await expect(transport.getConsent({ state: 'sealed-state' })).resolves.toMatchObject({
      clientName: 'Example RP',
      scopes: ['openid', 'profile', 'email'],
    });
    await expect(transport.submitConsentDecision({ decision: 'approve', state: 'sealed-state' })).resolves.toEqual({
      redirectTo: 'http://localhost:5397/callback?code=code-1&state=state-1',
    });
  });

  it('creates default and French labels with scope descriptions and overrides', () => {
    const labels = createDefaultOAuthConsentLabels({
      approve: 'Allow',
    });
    const french = createFrenchOAuthConsentLabels();

    expect(labels.title).toBe('Authorize application');
    expect(labels.approve).toBe('Allow');
    expect(labels.scopeDescriptions.email).toContain('email');
    expect(french.deny).toBe('Refuser');
    expect(french.scopeDescriptions.profile).toContain('profil');
  });
});
