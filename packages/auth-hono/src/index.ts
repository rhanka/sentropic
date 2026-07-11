// Canonical verify-core claim types are re-exported for back-compat: the shared
// verification primitives now live in @sentropic/oauth-verify (the 4 duplicate auth-hono
// verify paths delegate to it). Consumers may keep importing these from @sentropic/auth-hono.
export type {
  AccessTokenClaims,
  ActClaim,
  IdentityType,
  TokenKeySource,
} from '@sentropic/oauth-verify';

export * from './contracts.js';
export * from './credential-route-handlers.js';
export * from './federation/resolve-user.js';
export * from './email-verification.js';
export * from './magic-link.js';
export * from './middleware.js';
export * from './oauth/authorize-handler.js';
export * from './oauth/consent-decision-handler.js';
export * from './oauth/crypto-utils.js';
export * from './oauth/dpop.js';
export * from './oauth/end-session-handler.js';
export * from './oauth/http-utils.js';
export * from './oauth/introspect-handler.js';
export * from './oauth/issue-authorized-code.js';
export * from './oauth/jwks-service.js';
export * from './oauth/redirect-utils.js';
export * from './oauth/router.js';
export * from './oauth/revoke-handler.js';
export * from './oauth/service-auth-middleware.js';
export * from './oauth/session-resolver.js';
export * from './oauth/state-store-types.js';
export * from './oauth/state-codec.js';
export * from './oauth/token-handler.js';
export * from './oauth/userinfo-handler.js';
export * from './oauth/wellknown-handler.js';
export * from './ports.js';
export * from './route-handlers.js';
export * from './router.js';
export * from './session.js';
export * from './session-route-handlers.js';
export * from './webauthn-authentication.js';
export * from './webauthn-authentication-route-handlers.js';
export * from './webauthn-registration.js';
export * from './webauthn-registration-route-handlers.js';
