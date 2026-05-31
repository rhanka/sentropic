# @sentropic/auth-ui

Reusable Svelte authentication UI (passkeys + email OTP + magic link + device management) for apps that mount `@sentropic/auth-hono` (or compatible) auth routes.

The package is **host-adapter driven**. It owns the user-facing flow, the WebAuthn ceremony, the labels, and the visual layout — but it never touches the app's session store, navigation, API helpers, or backend implementation. Consumers inject a transport, callbacks, and labels and keep ownership of side-effects.

## Install

```bash
npm install @sentropic/auth-ui
# peer deps you already have:
#   svelte                   ^5.0.0
#   @simplewebauthn/browser  ^13.2.2
```

## Quick start

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import AuthLogin from '@sentropic/auth-ui/components/AuthLogin.svelte';
  import {
    createDefaultFetchTransport,
    createFrenchAuthUiLabels,
    type AuthUiSession,
  } from '@sentropic/auth-ui';

  const transport = createDefaultFetchTransport({
    baseUrl: '/auth',
    onUnauthorized: () => goto('/auth/login'),
  });
  const labels = createFrenchAuthUiLabels();

  async function handleLoggedIn(session: AuthUiSession) {
    // host owns the side-effects (store, cookies, redirect)
    sessionStorage.setItem('sessionToken', session.sessionToken ?? '');
    await goto('/dashboard');
  }
</script>

<AuthLogin {transport} {labels} onLoggedIn={handleLoggedIn} />
```

## Public surface

| Export path | Contents |
| --- | --- |
| `@sentropic/auth-ui` | `AuthUiTransport`, `AuthUiSession`, `AuthUiError`, `AuthUiLabels`, `createDefaultAuthUiLabels`, `createFrenchAuthUiLabels`, `createDefaultAuthUiBranding`, `assertAuthUiTransport`, `normalizeAuthEmail`, `createAuthUiError`, `createDefaultFetchTransport`, WebAuthn helpers |
| `@sentropic/auth-ui/components/AuthLogin.svelte` | Passkey login screen (discoverable credentials, lost-device path) |
| `@sentropic/auth-ui/components/AuthRegister.svelte` | Email-code → passkey registration; optional `skipEmailVerification` for hosts that own pre-auth |
| `@sentropic/auth-ui/components/AuthMagicLinkVerify.svelte` | Verifies a magic-link token from a host-supplied source |
| `@sentropic/auth-ui/components/AuthDevices.svelte` | Lists / renames / revokes registered passkeys |
| `@sentropic/auth-ui/components/AuthDevicePair.svelte` | Approves a device-code pairing (`approveDevicePairing` contract) |

All five components accept a `labels?: Partial<AuthUiLabels>` prop so hosts can override copy without forking. Each takes a `transport: AuthUiTransport` and one or more host callbacks (`onLoggedIn`, `onRegistered`, `onVerified`, `onPaired`, `onUnauthorized`, `onError`). Visual customisation flows through CSS custom properties (`--auth-primary`, `--auth-bg`, `--auth-text`, `--auth-radius`, `--auth-font-family`, …) and slots (`no-account`, `register-new-device`, `back-to-login`, `back-to-devices`, `pair-cta`, `add-device`, `login-link`, `cancel`).

## Transport boundary

`AuthUiTransport` is the only contract between the package and the backend. Implement it yourself, or use `createDefaultFetchTransport({ baseUrl, fetch?, headers?, onUnauthorized?, withCredentials? })` if your backend matches the `@sentropic/auth-hono` route shape:

| Method | Backend route |
| --- | --- |
| `requestEmailCode` | `POST {baseUrl}/email/verify-request` |
| `verifyEmailCode` | `POST {baseUrl}/email/verify-code` |
| `verifyMagicLink` | `POST {baseUrl}/magic-link/verify` |
| `createPasskeyRegistrationOptions` | `POST {baseUrl}/register/options` |
| `verifyPasskeyRegistration` | `POST {baseUrl}/register/verify` |
| `createPasskeyAuthenticationOptions` | `POST {baseUrl}/login/options` |
| `verifyPasskeyAuthentication` | `POST {baseUrl}/login/verify` |
| `refreshSession` | `POST {baseUrl}/session/refresh` |
| `logout` | `DELETE {baseUrl}/session` |
| `listCredentials` | `GET {baseUrl}/credentials` |
| `renameCredential` | `PUT {baseUrl}/credentials/{id}` |
| `revokeCredential` | `DELETE {baseUrl}/credentials/{id}` |
| `approveDevicePairing` | `POST {baseUrl}/device/approve` (auto-maps `userCode`/`deviceName` to snake_case body) |

## Mounting recipes

### Sentropic (`/auth/*`)

```ts
// ui/src/lib/services/auth-transport.ts
import { createDefaultFetchTransport, createDefaultAuthUiLabels, createFrenchAuthUiLabels, type AuthUiLabels } from '@sentropic/auth-ui';
import { apiFetch } from '$lib/utils/api';

export const createSentropicAuthTransport = (options: { onUnauthorized?: () => void } = {}) =>
  createDefaultFetchTransport({
    baseUrl: '/auth',
    fetch: (input, init) => apiFetch(input, init),
    onUnauthorized: options.onUnauthorized,
  });

export const resolveAuthUiLabels = (locale: string | null | undefined): AuthUiLabels =>
  (locale ?? 'fr').toLowerCase().startsWith('fr')
    ? createFrenchAuthUiLabels()
    : createDefaultAuthUiLabels();
```

```svelte
<!-- ui/src/routes/auth/login/+page.svelte -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { locale } from 'svelte-i18n';
  import AuthLogin from '@sentropic/auth-ui/components/AuthLogin.svelte';
  import { setUser } from '$lib/stores/session';
  import { createSentropicAuthTransport, resolveAuthUiLabels, toSentropicUser } from '$lib/services/auth-transport';

  const transport = createSentropicAuthTransport();
  $: labels = resolveAuthUiLabels($locale);

  async function handleLoggedIn(session) {
    setUser(toSentropicUser(session.user));
    await goto('/neutral');
  }
</script>

<AuthLogin {transport} {labels} onLoggedIn={handleLoggedIn} />
```

### Admin-flavoured host (`/admin/auth/*`)

```ts
const adminTransport = createDefaultFetchTransport({
  baseUrl: '/admin/auth',
  headers: { Authorization: `Bearer ${tenantToken}`, 'x-admin-tenant': tenant },
  withCredentials: false,
  onUnauthorized: () => location.assign('/admin/sign-in'),
});

const adminLabels = createFrenchAuthUiLabels({
  loginTitle: 'Connexion admin',
  loginButton: 'Se connecter (admin)',
  registerTitle: 'Inviter un administrateur',
});
```

See `tests/example-admin-fetch-transport.test.ts` for a full walkthrough.

## Brand assets, FR labels, post-login redirects

- **Brand assets**: pass slot content (`no-account`, `register-new-device`, …) for app-specific link shapes (SvelteKit `<a>`, plain anchor, modal trigger). Use CSS variables for primary color, radius, fonts.
- **French labels**: `createFrenchAuthUiLabels(overrides?)` ships a complete FR baseline; partial overrides keep the unchanged keys.
- **Post-login redirects**: never built into the components — call `goto(returnUrl)` / `location.assign(...)` from `onLoggedIn` / `onRegistered` / `onVerified` / `onRedirect`. `AuthMagicLinkVerify` exposes `redirectDelayMs` (defaults to 1000 ms) so the success screen has time to render before the host redirect fires.

## Backend coupling (BR-39b)

`@sentropic/auth-hono` provides reusable Hono route factories that match this transport shape 1:1. It is **not required** to adopt this UI package — any backend that exposes the routes listed above will work. BR-39b removes the duplicated backend code from Sentropic, but the UI package was usable before that landed.

## Versioning

Follows semver. Every PR that touches `packages/auth-ui/src/**` must bump `version` in `packages/auth-ui/package.json` (patch for bugfix, minor for feature, major for breaking). The CI `enforce-package-bump` job blocks merge otherwise.

## First publish

A brand-new package requires a one-shot bootstrap:

1. Trigger `workflow_dispatch` on `ci.yml` with `bootstrap_publish_target=auth-ui` (uses the `NPM_TOKEN` secret).
2. On `https://www.npmjs.com/package/@sentropic/auth-ui/access`, attach the OIDC trusted publisher pointing to `rhanka/sentropic` workflow `ci.yml`.
3. From then on, steady-state CI publishes via OIDC trusted publishing on every merge to `main` that bumps the version.

## License

MIT — see `LICENSE`.
