import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { AuthHonoPorts, AuthHonoWebAuthnRegistrationService, AuthHonoWebAuthnAuthenticationService, AuthHonoVerifiedRegistrationResponse } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { WebAuthnChallengeV1 } from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';
import { finishAuthCompletion, guardAuthStep, refuseWebAuthn } from './auth-abort.js';

export const authHonoRuntime = () => createRequire(import.meta.url)(fileURLToPath(import.meta.resolve('@sentropic/auth-hono'))) as typeof import('@sentropic/auth-hono');
export type AuthUv = 'required' | 'preferred' | 'discouraged';
export interface WebAuthnAttempt {
  flow: 'registration' | 'authentication' | null;
  completionOwner: string | null;
  assertion?: { credentialId: string; newCounter: number };
  owner: string | null;
  registration: AuthHonoVerifiedRegistrationResponse['registrationInfo'] | undefined;
  registrationUv: boolean;
  issuanceUv: AuthUv;
}
const strongest = (...values: AuthUv[]): AuthUv => values.includes('required') ? 'required' : values.includes('preferred') ? 'preferred' : 'discouraged';
export const authWebAuthnServices = <H>(input: IdentityAuthBindingInput<H>, ports: AuthHonoPorts, state: WebAuthnAttempt,
  challenge: () => WebAuthnChallengeV1 | undefined, consumeTicket: (id: string) => Promise<void>, check: () => void,
): { registration: AuthHonoWebAuthnRegistrationService; authentication: AuthHonoWebAuthnAuthenticationService } => {
  const runtime = authHonoRuntime();
  const server = createRequire(import.meta.resolve('@sentropic/auth-hono'))('@simplewebauthn/server') as {
    verifyRegistrationResponse: NonNullable<Parameters<typeof runtime.createAuthWebAuthnRegistrationService>[0]['verifyRegistrationResponse']>;
    verifyAuthenticationResponse: NonNullable<Parameters<typeof runtime.createAuthWebAuthnAuthenticationService>[0]['verifyAuthenticationResponse']>;
  };
  const uv = async (flow: 'registration' | 'authentication', id?: string | null): Promise<AuthUv> => {
    const user = id ? await ports.users.findById(id) : null;
    return strongest(flow === 'registration' ? input.webAuthnPolicy.registrationUserVerification : input.webAuthnPolicy.authenticationUserVerification,
      user ? input.accountPolicy.resolveUserVerification?.(user) ?? (flow === 'registration' ? 'preferred' : 'required') : flow === 'registration' ? 'preferred' : 'required');
  };
  const verificationPolicy = async (flow: 'registration' | 'authentication') => {
    const stored = challenge();
    if (!stored) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
    const origins = stored.allowedOrigins.filter((origin) => input.rp.expectedOrigins.includes(origin));
    if (stored.rpId !== input.rp.id || origins.length === 0) refuseWebAuthn(flow, flow + '_verification_failed', flow === 'registration' ? 'Registration verification failed.' : 'Authentication verification failed.', flow === 'registration' ? 400 : 401);
    return { expectedRPID: stored.rpId, expectedOrigin: origins, requireUserVerification: strongest(stored.userVerification, await uv(flow, state.owner)) === 'required' };
  };
  const registration = runtime.createAuthWebAuthnRegistrationService({ ports, rp: input.rp,
    verifyRegistrationResponse: async (args) => {
      const policy = await verificationPolicy('registration');
      let result;
      try { result = await server.verifyRegistrationResponse({ ...args, ...policy }); }
      catch { return refuseWebAuthn('registration', 'registration_verification_failed', 'Registration verification failed.', 400); }
      if (result.verified && result.registrationInfo) {
        if (policy.requireUserVerification && !result.registrationInfo.userVerified) refuseWebAuthn('registration', 'registration_verification_failed', 'Registration verification failed.', 400);
        state.registration = result.registrationInfo; state.registrationUv = result.registrationInfo.userVerified;
      }
      return result;
    },
  });
  const authentication = runtime.createAuthWebAuthnAuthenticationService({ ports, rp: input.rp,
    verifyAuthenticationResponse: async (args) => {
      const policy = await verificationPolicy('authentication');
      let result;
      try { result = await server.verifyAuthenticationResponse({ ...args, ...policy }); }
      catch { return refuseWebAuthn('authentication', 'authentication_verification_failed', 'Authentication verification failed.', 401); }
      if (result.verified && policy.requireUserVerification && !result.authenticationInfo.userVerified) refuseWebAuthn('authentication', 'user_verification_required', 'User verification is required.', 403);
      if (result.verified) state.assertion = { credentialId: args.credential.id, newCounter: result.authenticationInfo.newCounter };
      return result;
    },
  });
  return {
    registration: {
      generateRegistrationOptions: async (value) => {
        check(); state.issuanceUv = await uv('registration', value.userId);
        const options = await registration.generateRegistrationOptions(value);
        options.authenticatorSelection = { ...options.authenticatorSelection, userVerification: state.issuanceUv };
        return options;
      },
      verifyRegistration: async (value) => {
        check(); state.flow = 'registration'; state.owner = value.userId; state.registration = undefined; state.completionOwner = null;
        return finishAuthCompletion('registration', await guardAuthStep('registration', 'credential', () => registration.verifyRegistration({ ...value,
          beforePersist: async (context) => guardAuthStep('registration', 'ticket', async () => {
            await consumeTicket(context.userId); await value.beforePersist?.(context);
          }),
        })));
      },
    },
    authentication: {
      generateAuthenticationOptions: async (value) => {
        check(); state.issuanceUv = await uv('authentication', value.userId);
        const options = await authentication.generateAuthenticationOptions(value);
        options.userVerification = state.issuanceUv; return options;
      },
      verifyAuthentication: async (value) => {
        check(); state.flow = 'authentication'; state.owner = null; state.completionOwner = null; state.assertion = undefined;
        return finishAuthCompletion('authentication', await guardAuthStep('authentication', 'credential', () => authentication.verifyAuthentication(value)));
      },
    },
  };
};
