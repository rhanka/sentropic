import type {
  AuthHonoWebAuthnAuthenticationService,
  AuthHonoWebAuthnRegistrationService,
} from '@sentropic/auth-hono';
import { generateWebAuthnAuthenticationOptions } from '../webauthn-authentication';
import { generateWebAuthnRegistrationOptions } from '../webauthn-registration';

/**
 * Sentropic adapters for `@sentropic/auth-hono` WebAuthn services.
 *
 * Only the `generate*Options` methods are implemented; `verify*` methods stay
 * app-owned for now and throw on call. Once the `register/verify` and
 * `login/verify` routes consume the package via the `finalize*` hooks, the
 * `verify*` methods will delegate to the existing app `verifyWebAuthn*`
 * functions (with challenge replay protection wired in).
 */

export const authHonoWebAuthnRegistrationService: AuthHonoWebAuthnRegistrationService = {
  async generateRegistrationOptions({ userDisplayName, userId, userName }) {
    return generateWebAuthnRegistrationOptions({
      userDisplayName,
      userId,
      userName,
    });
  },

  async verifyRegistration() {
    throw new Error('WebAuthn registration verification remains app-owned in Sentropic API.');
  },
};

export const authHonoWebAuthnAuthenticationService: AuthHonoWebAuthnAuthenticationService = {
  async generateAuthenticationOptions({ userId }) {
    return generateWebAuthnAuthenticationOptions({ userId });
  },

  async verifyAuthentication() {
    throw new Error('WebAuthn authentication verification remains app-owned in Sentropic API.');
  },
};
