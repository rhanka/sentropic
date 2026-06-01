import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedAuthenticationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialRequestOptionsJSON,
  UserVerificationRequirement,
} from '@simplewebauthn/server';

import type { AuthHonoCredentialRecord, AuthHonoPorts } from './ports.js';
import type { AuthHonoRelyingPartyConfig } from './webauthn-registration.js';

export interface CreateAuthWebAuthnAuthenticationServiceOptions {
  challengeBytes?: number;
  challengeTtlSeconds?: number;
  ports: AuthHonoPorts;
  rp: AuthHonoRelyingPartyConfig;
  timeoutMs?: number;
  verifyAuthenticationResponse?: typeof verifyAuthenticationResponse;
}

export interface AuthHonoGenerateAuthenticationOptionsInput {
  userId?: string;
}

export interface AuthHonoVerifyAuthenticationInput {
  credential: AuthenticationResponseJSON;
  expectedChallenge: string;
}

export type AuthHonoVerifyAuthenticationResult =
  | {
      credentialId: string;
      userId: string;
      verified: true;
    }
  | {
      error: AuthHonoWebAuthnAuthenticationError;
      verified: false;
    };

export interface AuthHonoWebAuthnAuthenticationError {
  code: string;
  message: string;
  status: number;
}

export interface AuthHonoWebAuthnAuthenticationService {
  generateAuthenticationOptions(
    input: AuthHonoGenerateAuthenticationOptionsInput
  ): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication(input: AuthHonoVerifyAuthenticationInput): Promise<AuthHonoVerifyAuthenticationResult>;
}

export const createAuthWebAuthnAuthenticationService = (
  options: CreateAuthWebAuthnAuthenticationServiceOptions
): AuthHonoWebAuthnAuthenticationService => {
  const challengeBytes = options.challengeBytes ?? 32;
  const challengeTtlSeconds = options.challengeTtlSeconds ?? 5 * 60;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const verifyResponse = options.verifyAuthenticationResponse ?? verifyAuthenticationResponse;

  return {
    async generateAuthenticationOptions(input) {
      const user = input.userId ? await options.ports.users.findById(input.userId) : null;
      const credentials = input.userId ? await options.ports.credentials.listForUser(input.userId) : [];
      const challenge = options.ports.random.token(challengeBytes);
      const challengeRecord = await options.ports.challenges.create({
        challenge,
        expiresAt: options.ports.clock.addSeconds(options.ports.clock.now(), challengeTtlSeconds),
        type: 'authentication',
        userId: input.userId ?? null,
      });

      const generatedOptions = await generateAuthenticationOptions({
        allowCredentials:
          credentials.length > 0
            ? credentials.map((credential) => ({
                id: credential.credentialId,
                transports: toAuthenticatorTransports(credential.transports),
              }))
            : undefined,
        challenge: challengeRecord.challenge,
        rpID: options.rp.id,
        timeout: timeoutMs,
        userVerification: resolveUserVerification(options.ports, user),
      });

      generatedOptions.challenge = challengeRecord.challenge;
      return generatedOptions;
    },

    async verifyAuthentication(input) {
      const storedCredential = await options.ports.credentials.findByCredentialId(input.credential.id);

      if (!storedCredential || storedCredential.revokedAt) {
        return invalidAuthentication('credential_not_found', 'Credential was not found.', 401);
      }

      const challenge = await options.ports.challenges.findValid(
        input.expectedChallenge,
        'authentication'
      );

      if (!challenge || challenge.used || challenge.expiresAt <= options.ports.clock.now()) {
        return invalidAuthentication('invalid_or_expired_challenge', 'Authentication challenge is invalid or expired.');
      }

      if (challenge.userId && challenge.userId !== storedCredential.userId) {
        return invalidAuthentication('challenge_user_mismatch', 'Authentication challenge does not belong to this user.');
      }

      const user = await options.ports.users.findById(storedCredential.userId);

      if (!user) {
        return invalidAuthentication('user_not_found', 'Credential user was not found.', 404);
      }

      const requireUserVerification = resolveUserVerification(options.ports, user) === 'required';
      const verification = await verifyResponse({
        credential: toWebAuthnCredential(storedCredential),
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: options.rp.expectedOrigins,
        expectedRPID: options.rp.id,
        requireUserVerification,
        response: input.credential,
      });

      if (!verification.verified) {
        return invalidAuthentication('authentication_verification_failed', 'Authentication verification failed.', 401);
      }

      if (requireUserVerification && !verification.authenticationInfo.userVerified) {
        return invalidAuthentication('user_verification_required', 'User verification is required.', 403);
      }

      const now = options.ports.clock.now();
      await options.ports.credentials.updateCounter(
        storedCredential.credentialId,
        verification.authenticationInfo.newCounter,
        now
      );
      await options.ports.challenges.markUsed(input.expectedChallenge);

      return {
        credentialId: storedCredential.credentialId,
        userId: storedCredential.userId,
        verified: true,
      };
    },
  };
};

const toWebAuthnCredential = (credential: AuthHonoCredentialRecord): WebAuthnCredential => ({
  counter: credential.counter,
  id: credential.credentialId,
  publicKey: toUint8Array(credential.publicKey),
  transports: toAuthenticatorTransports(credential.transports),
});

const toAuthenticatorTransports = (
  transports: string[] | null
): AuthenticatorTransportFuture[] | undefined => {
  if (!transports || transports.length === 0) {
    return undefined;
  }

  return transports as AuthenticatorTransportFuture[];
};

const toUint8Array = (value: Uint8Array | ArrayBuffer | string): Uint8Array => {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return new TextEncoder().encode(value);
};

const resolveUserVerification = (
  ports: AuthHonoPorts,
  user: Awaited<ReturnType<AuthHonoPorts['users']['findById']>>
): UserVerificationRequirement => {
  if (!user) {
    return 'preferred';
  }

  return ports.accountPolicy.resolveUserVerification?.(user) ?? 'preferred';
};

const invalidAuthentication = (
  code: string,
  message: string,
  status = 400
): AuthHonoVerifyAuthenticationResult => ({
  error: {
    code,
    message,
    status,
  },
  verified: false,
});

export type AuthHonoVerifiedAuthenticationResponse = VerifiedAuthenticationResponse;
