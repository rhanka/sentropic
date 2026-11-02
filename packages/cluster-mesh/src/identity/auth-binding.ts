import type { AuthHonoPorts } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput, IdentityAuthHonoTransactionBindingV1, IdentityDeferredMailV1 } from '../identity-contracts/custody-auth.js';
import { assertIdentityTransactionActive } from '../storage/identity/custody-transaction-guards.js';
import { authUserPorts } from './auth-users.js';
import { authCredentialPort } from './auth-credentials.js';
import { authProofPorts } from './auth-proofs.js';
import { authEmailService } from './auth-email.js';
import { authSessionService } from './auth-sessions.js';
import { authFederationPort } from './auth-social.js';
import { authBoundaryPorts } from './auth-boundary.js';
import { authHonoRuntime, authWebAuthnServices, type WebAuthnAttempt } from './auth-webauthn.js';
import { finishAuthCompletion, guardAuthStep } from './auth-abort.js';

export const createIdentityAuthHonoTransactionBindingV1 = <H>(input: IdentityAuthBindingInput<H>): IdentityAuthHonoTransactionBindingV1 => {
  const check = () => assertIdentityTransactionActive(input.tx, true);
  check();
  const evidence = new Set<string>(), deferredMail: IdentityDeferredMailV1[] = [];
  const state: WebAuthnAttempt = { flow: null, completionOwner: null, owner: null, registration: undefined, registrationUv: false, issuanceUv: 'required' };
  const { users, policy } = authUserPorts(input, evidence, check);
  const proofs = authProofPorts(input, evidence, check, state);
  const credentials = authCredentialPort(input, check, state);
  const boundary = authBoundaryPorts(input, users, policy, check);
  const email = authEmailService(input, evidence, check, (address, code, expiresAt) => { deferredMail.push({ kind: 'code', email: address, code, expiresAt }); });
  const sessions = authSessionService(input, users, policy, check);
  const federation = authFederationPort(input, check);
  const ports: AuthHonoPorts = {
    ...input.hostPorts, users, accountPolicy: policy, credentials, ...proofs, sessions: sessions.port, emailVerification: email.port,
    federation, tokens: boundary.tokens, auditLog: boundary.auditLog,
    emailDelivery: {
      sendVerificationCode: async (mail) => { check(); deferredMail.push({ ...mail, kind: 'code', expiresAt: mail.expiresAt.toISOString() }); },
      sendMagicLink: async (mail) => { check(); deferredMail.push({ ...mail, kind: 'magic_link', expiresAt: mail.expiresAt.toISOString() }); },
    },
  };
  const webauthn = authWebAuthnServices(input, ports, state, proofs.verificationPolicy, email.consumeRegistration, check);
  const magicLink = authHonoRuntime().createAuthMagicLinkService({ ports, ...input.magicLink });
  return {
    ports, ...webauthn, flushAudit: boundary.flushAudit,
    get deferredMail() { return deferredMail.map((mail) => ({ ...mail })); },
    magicLink: {
      requestMagicLink: async (value) => finishAuthCompletion('magic_link_issue', await magicLink.requestMagicLink(value)),
      verifyMagicLink: async (value) => {
        const result = await guardAuthStep('magic_link', 'proof', () => magicLink.verifyMagicLink(value));
        if (result.valid && !(await policy.canAuthenticate(result.user, input.hostPorts.clock.now())).allowed) {
          return finishAuthCompletion('magic_link', { valid: false as const, error: { code: 'invalid_or_expired_magic_link', message: 'Magic link is invalid or expired.', status: 400 } });
        }
        return finishAuthCompletion('magic_link', result);
      },
    },
    emailVerification: {
      requestEmailCode: async (value) => finishAuthCompletion('email_code_issue', await email.service.requestEmailCode(value)),
      verifyEmailCode: async (value) => finishAuthCompletion('email_code', await guardAuthStep('email_code', 'proof', () => email.service.verifyEmailCode(value))),
    },
    sessions: { ...sessions.service,
      validateSessionToken: async (token) => finishAuthCompletion('session_validate', await guardAuthStep('session_validate', 'session', () => sessions.service.validateSessionToken(token))),
      refreshSession: async (token) => finishAuthCompletion('session_refresh', await guardAuthStep('session_refresh', 'session', () => sessions.service.refreshSession(token))),
    },
    resolveFederatedUser: async (value) => {
      check(); if (value.email && value.emailVerifiedByProvider) evidence.add(policy.normalizeEmail(value.email));
      return authHonoRuntime().resolveOrCreateFederatedUser({ federation, users, accountPolicy: policy,
        autoLinkProviders: new Set(input.social.autoLinkProviders), provisionWorkspace: (id) => input.business.provisionWorkspace(id, input.tx),
        isFirstUser: async () => (await users.count()) === 0,
      }, { ...value, now: input.hostPorts.clock.now() });
    },
  };
};
