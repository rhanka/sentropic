// Optional-peer auth entrypoint: the identity auth surface that binds a
// transaction to @sentropic/auth-hono ports. It lives behind this subpath so
// the root entry and its emitted declarations never reference the optional
// peer; import it only when the peer is installed. All peer access stays
// type-only at module scope or lazy inside the factories.
export * from '../identity-contracts/custody-auth.js';
export * from './auth-binding.js';
export * from './auth-completion.js';
export * from './auth-service-tenant.js';
