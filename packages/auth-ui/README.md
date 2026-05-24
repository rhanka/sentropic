# @sentropic/auth-ui

Reusable authentication UI contracts and browser passkey helpers for Svelte applications.

This package is host-adapter driven. It does not import Sentropic app stores, SvelteKit navigation, API route helpers, or backend implementation code. Consumers provide the transport that maps their API paths to the package contract.

## Public Surface

- `@sentropic/auth-ui` re-exports the Lot 1 TypeScript surface.
- `@sentropic/auth-ui/contracts` exports transport, result, label, branding, navigation, callback, session, user, and credential types.
- `@sentropic/auth-ui/webauthn` exports browser support checks and passkey ceremony helpers.

## Transport Boundary

Hosts map their own endpoints into `AuthUiTransport`.

```ts
import type { AuthUiTransport } from '@sentropic/auth-ui';

export const transport: AuthUiTransport = {
  requestEmailCode: (input) => post('/auth/email/verify-request', input),
  verifyEmailCode: (input) => post('/auth/email/verify-code', input),
  verifyMagicLink: (input) => post('/auth/magic-link/verify', input),
  createPasskeyRegistrationOptions: (input) => post('/auth/register/options', input),
  verifyPasskeyRegistration: (input) => post('/auth/register/verify', input),
  createPasskeyAuthenticationOptions: (input) => post('/auth/login/options', input),
  verifyPasskeyAuthentication: (input) => post('/auth/login/verify', input),
  refreshSession: () => post('/auth/refresh', {}),
  logout: () => post('/auth/logout', {}),
  listCredentials: () => get('/auth/credentials'),
  renameCredential: (input) => put(`/auth/credentials/${input.credentialId}`, input),
  revokeCredential: (input) => del(`/auth/credentials/${input.credentialId}`),
};
```

Downstream apps with a different route prefix keep that prefix in their host adapter:

```ts
const adminTransport: AuthUiTransport = {
  requestEmailCode: (input) => post('/admin/auth/email/otp', input),
  verifyEmailCode: (input) => post('/admin/auth/email/verify', input),
  verifyMagicLink: (input) => post('/admin/auth/magic-link/verify', input),
  createPasskeyRegistrationOptions: (input) => post('/admin/auth/passkey/register/options', input),
  verifyPasskeyRegistration: (input) => post('/admin/auth/passkey/register/verify', input),
  createPasskeyAuthenticationOptions: (input) => post('/admin/auth/passkey/login/options', input),
  verifyPasskeyAuthentication: (input) => post('/admin/auth/passkey/login/verify', input),
  refreshSession: () => post('/admin/auth/session/refresh', {}),
  logout: () => post('/admin/auth/logout', {}),
  listCredentials: () => get('/admin/auth/passkeys'),
  renameCredential: (input) => put(`/admin/auth/passkeys/${input.credentialId}`, input),
  revokeCredential: (input) => del(`/admin/auth/passkeys/${input.credentialId}`),
};
```

## WebAuthn Helpers

The helpers wrap `@simplewebauthn/browser` but accept injectable starters for deterministic tests and non-standard hosts.

```ts
import { startPasskeyAuthentication } from '@sentropic/auth-ui';

const credential = await startPasskeyAuthentication(options);
```

## Branding And Labels

Use `createDefaultAuthUiLabels()` and `createDefaultAuthUiBranding()` as starting points. The defaults intentionally avoid hardcoded Sentropic product names so consumers can provide their own product copy.

## Publication Note

This is a brand-new public package. First publish requires the one-shot bootstrap flow from `rules/workflow.md`: trigger `ci.yml` with `bootstrap_publish_target=auth-ui`, then attach the npm OIDC trusted publisher for `rhanka/sentropic` workflow `ci.yml`. Steady-state publishes should use trusted publishing and skip if the version already exists.
