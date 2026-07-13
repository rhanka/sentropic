import { env } from '../../../config/env';
import { createAppleProvider } from './apple-provider';
import { createFacebookProvider } from './facebook-provider';
import { createGithubProvider } from './github-provider';
import { createGoogleProvider } from './google-provider';
import { createMicrosoftProvider } from './microsoft-provider';
import type { FederationProvider } from './types';

/**
 * BR-39e — provider registry. v1 registers Google, GitHub, Microsoft, Facebook, and Apple. A provider
 * present in the registry but missing its env credentials resolves to `null` (feature-OFF): the route
 * answers a clear "provider not configured" instead of crashing. An id absent from the registry is
 * "not supported".
 */

type FederationProviderFactory = (ctx: {
  defaultRedirectUri: string;
}) => FederationProvider | null;

const REGISTRY: Record<string, FederationProviderFactory> = {
  apple: ({ defaultRedirectUri }) => {
    const clientId = env.APPLE_OAUTH_CLIENT_ID;
    const teamId = env.APPLE_TEAM_ID;
    const keyId = env.APPLE_KEY_ID;
    const privateKeyPem = env.APPLE_PRIVATE_KEY;
    if (!clientId || !teamId || !keyId || !privateKeyPem) return null;
    const redirectUri = env.APPLE_OAUTH_REDIRECT_URI ?? defaultRedirectUri;
    return createAppleProvider({ clientId, keyId, privateKeyPem, redirectUri, teamId });
  },
  facebook: ({ defaultRedirectUri }) => {
    const clientId = env.FACEBOOK_OAUTH_CLIENT_ID;
    const clientSecret = env.FACEBOOK_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    const redirectUri = env.FACEBOOK_OAUTH_REDIRECT_URI ?? defaultRedirectUri;
    return createFacebookProvider({ clientId, clientSecret, redirectUri });
  },
  github: ({ defaultRedirectUri }) => {
    const clientId = env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;
    // Feature-flag: absent client credentials → provider not configured (never a crash).
    if (!clientId || !clientSecret) return null;
    const redirectUri = env.GITHUB_OAUTH_REDIRECT_URI ?? defaultRedirectUri;
    return createGithubProvider({ clientId, clientSecret, redirectUri });
  },
  google: ({ defaultRedirectUri }) => {
    const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
    // Feature-flag: absent client credentials → provider not configured (never a crash).
    if (!clientId || !clientSecret) return null;
    const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI ?? defaultRedirectUri;
    return createGoogleProvider({ clientId, clientSecret, redirectUri });
  },
  microsoft: ({ defaultRedirectUri }) => {
    const clientId = env.MICROSOFT_OAUTH_CLIENT_ID;
    const clientSecret = env.MICROSOFT_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    const redirectUri = env.MICROSOFT_OAUTH_REDIRECT_URI ?? defaultRedirectUri;
    return createMicrosoftProvider({
      clientId,
      clientSecret,
      redirectUri,
      tenant: env.MICROSOFT_OAUTH_TENANT,
    });
  },
};

/** True iff `providerId` is a federation provider this build knows about. */
export const isFederationProviderSupported = (providerId: string): boolean =>
  Object.prototype.hasOwnProperty.call(REGISTRY, providerId);

/**
 * Resolve a configured provider, or `null` when it is supported but not configured (feature-OFF).
 * The route MUST call `isFederationProviderSupported` first to distinguish 404 (unknown) from 503
 * (known but not configured).
 */
export const resolveFederationProvider = (
  providerId: string,
  ctx: { defaultRedirectUri: string }
): FederationProvider | null => {
  const factory = REGISTRY[providerId];
  return factory ? factory(ctx) : null;
};
