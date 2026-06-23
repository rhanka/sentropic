import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AttestationConveyancePreference,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  UserVerificationRequirement,
} from '@simplewebauthn/server';

import type { AuthHonoPorts } from './ports.js';

export interface AuthHonoRelyingPartyConfig {
  expectedOrigins: string[];
  id: string;
  name: string;
}

export interface CreateAuthWebAuthnRegistrationServiceOptions {
  attestation?: AttestationConveyancePreference;
  challengeBytes?: number;
  challengeTtlSeconds?: number;
  ports: AuthHonoPorts;
  rp: AuthHonoRelyingPartyConfig;
  timeoutMs?: number;
  verifyRegistrationResponse?: typeof verifyRegistrationResponse;
}

export interface AuthHonoGenerateRegistrationOptionsInput {
  userDisplayName: string;
  userId?: string;
  userName: string;
}

/**
 * BR-39r L4 — pre-persist hook. Invoked AFTER the WebAuthn response is cryptographically
 * verified but BEFORE the credential row is persisted. Used to atomically consume a single-use
 * invitation token inside the registration flow: if it throws (consume lost the race / invalid),
 * the credential is NEVER created (no orphan), guaranteeing single-use. A resolved hook means
 * "proceed with persistence". The service is contractually required to call this exactly once,
 * immediately before its `credentials.create`, and to abort persistence if it rejects.
 */
export type AuthHonoBeforePersistCredential = (input: { userId: string }) => Promise<void> | void;

export interface AuthHonoVerifyRegistrationInput {
  credential: RegistrationResponseJSON;
  deviceName?: string;
  expectedChallenge: string;
  userId: string;
  beforePersist?: AuthHonoBeforePersistCredential;
}

export type AuthHonoVerifyRegistrationResult =
  | {
      credentialId: string;
      verified: true;
    }
  | {
      error: AuthHonoWebAuthnRegistrationError;
      verified: false;
    };

export interface AuthHonoWebAuthnRegistrationError {
  code: string;
  message: string;
  status: number;
}

export interface AuthHonoWebAuthnRegistrationService {
  generateRegistrationOptions(
    input: AuthHonoGenerateRegistrationOptionsInput
  ): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistration(input: AuthHonoVerifyRegistrationInput): Promise<AuthHonoVerifyRegistrationResult>;
}

export const createAuthWebAuthnRegistrationService = (
  options: CreateAuthWebAuthnRegistrationServiceOptions
): AuthHonoWebAuthnRegistrationService => {
  const challengeBytes = options.challengeBytes ?? 32;
  const challengeTtlSeconds = options.challengeTtlSeconds ?? 5 * 60;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const verifyResponse = options.verifyRegistrationResponse ?? verifyRegistrationResponse;

  return {
    async generateRegistrationOptions(input) {
      const user = input.userId ? await options.ports.users.findById(input.userId) : null;
      const existingCredentials = input.userId
        ? await options.ports.credentials.listForUser(input.userId)
        : [];
      const challenge = options.ports.random.token(challengeBytes);
      const challengeRecord = await options.ports.challenges.create({
        challenge,
        expiresAt: options.ports.clock.addSeconds(options.ports.clock.now(), challengeTtlSeconds),
        type: 'registration',
        userId: input.userId ?? null,
      });

      const generatedOptions = await generateRegistrationOptions({
        attestationType: normalizeAttestation(options.attestation),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: resolveUserVerification(options.ports, user),
        },
        challenge: challengeRecord.challenge,
        excludeCredentials: existingCredentials.map((credential) => ({
          id: credential.credentialId,
          transports: toAuthenticatorTransports(credential.transports),
        })),
        rpID: options.rp.id,
        rpName: options.rp.name,
        timeout: timeoutMs,
        userDisplayName: input.userDisplayName,
        userName: input.userName,
      });

      generatedOptions.challenge = challengeRecord.challenge;
      return generatedOptions;
    },

    async verifyRegistration(input) {
      const challenge = await options.ports.challenges.findValid(
        input.expectedChallenge,
        'registration'
      );

      if (!challenge || challenge.used || challenge.expiresAt <= options.ports.clock.now()) {
        return invalidRegistration('invalid_or_expired_challenge', 'Registration challenge is invalid or expired.');
      }

      if (challenge.userId && challenge.userId !== input.userId) {
        return invalidRegistration('challenge_user_mismatch', 'Registration challenge does not belong to this user.');
      }

      const verification = await verifyResponse({
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: options.rp.expectedOrigins,
        expectedRPID: options.rp.id,
        requireUserVerification: false,
        response: input.credential,
      });

      if (!verification.verified || !verification.registrationInfo?.credential) {
        return invalidRegistration('registration_verification_failed', 'Registration verification failed.');
      }

      const credential = verification.registrationInfo.credential;
      const credentialId = credential.id;
      const existing = await options.ports.credentials.findByCredentialId(credentialId);

      if (existing && !existing.revokedAt) {
        return invalidRegistration('duplicate_credential', 'Credential is already registered.', 409);
      }

      // BR-39r L4: pre-persist hook (atomic invite consume). Verified above; if this rejects,
      // we propagate and the credential is NOT created (no orphan, single-use guaranteed).
      if (input.beforePersist) {
        await input.beforePersist({ userId: input.userId });
      }

      await options.ports.credentials.create({
        backedUp: verification.registrationInfo.credentialBackedUp,
        counter: credential.counter,
        credentialId,
        deviceType: verification.registrationInfo.credentialDeviceType,
        name: input.deviceName ?? verification.registrationInfo.credentialDeviceType ?? 'Unknown Device',
        publicKey: credential.publicKey,
        transports: input.credential.response.transports ?? [],
        userId: input.userId,
      });
      await options.ports.challenges.markUsed(input.expectedChallenge);

      return {
        credentialId,
        verified: true,
      };
    },
  };
};

const toAuthenticatorTransports = (
  transports: string[] | null
): AuthenticatorTransportFuture[] => (transports ?? []) as AuthenticatorTransportFuture[];

const normalizeAttestation = (
  attestation: AttestationConveyancePreference | undefined
): 'none' | 'direct' | 'enterprise' | undefined => {
  if (attestation === 'indirect') {
    return 'none';
  }

  return attestation as 'none' | 'direct' | 'enterprise' | undefined;
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

const invalidRegistration = (
  code: string,
  message: string,
  status = 400
): AuthHonoVerifyRegistrationResult => ({
  error: {
    code,
    message,
    status,
  },
  verified: false,
});

export type AuthHonoVerifiedRegistrationResponse = VerifiedRegistrationResponse;
