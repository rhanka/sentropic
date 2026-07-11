import { env } from '../../../config/env';
import { createGoogleProvider } from './google-provider';
import type { FederationProvider } from './types';

/**
 * BR-39e Lot 1 — provider registry. v1 registers ONLY 'google'. A provider present in the registry
 * but missing its env credentials resolves to `null` (feature-OFF): the route answers a clear
 * "provider not configured" instead of crashing. An id absent from the registry is "not supported".
 * Later lots add github/microsoft/apple/facebook behind the same seam.
 */

type FederationProviderFactory = (ctx: { defaultRedirectUri: string }) => FederationProvider | null;

const REGISTRY: Record<string, FederationProviderFactory> = {
  google: ({ defaultRedirectUri }) => {
    const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
    // Feature-flag: absent client credentials → provider not configured (never a crash).
    if (!clientId || !clientSecret) return null;
    const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI ?? defaultRedirectUri;
    return createGoogleProvider({ clientId, clientSecret, redirectUri });
  },
};

/** True iff `providerId` is a federation provider this build knows about (v1: google only). */
export const isFederationProviderSupported = (providerId: string): boolean =>
  Object.prototype.hasOwnProperty.call(REGISTRY, providerId);

/**
 * Resolve a configured provider, or `null` when it is supported but not configured (feature-OFF).
 * The route MUST call `isFederationProviderSupported` first to distinguish 404 (unknown) from 503
 * (known but not configured).
 */
export const resolveFederationProvider = (
  providerId: string,
  ctx: { defaultRedirectUri: string },
): FederationProvider | null => {
  const factory = REGISTRY[providerId];
  return factory ? factory(ctx) : null;
};
