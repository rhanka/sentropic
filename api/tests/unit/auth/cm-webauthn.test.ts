import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withAppCmAuth } from '../../../src/services/identity/cm-auth-runtime';
import { createCmUser } from '../../../src/services/identity/cm-users';
import { findCmCredentialByCredentialId } from '../../../src/services/identity/cm-proofs';
import { getWebAuthnConfig } from '../../../src/services/webauthn-config';
import { cmDeleteForUsers, cmQuery, cmTable } from '../../utils/cm-identity-test-store';
import { createSyntheticPasskey } from '../../utils/synthetic-passkey';

describe('CM WebAuthn services with actual attestation and assertion verification', () => {
  let userId: string, passkey: ReturnType<typeof createSyntheticPasskey>;
  const users: string[] = [], challenges: string[] = [];
  beforeEach(async () => {
    userId = randomUUID(); users.push(userId);
    await createCmUser({ userId, email: `${userId}@example.com`, role: 'editor', emailVerified: true });
    const config = getWebAuthnConfig();
    passkey = createSyntheticPasskey(config.rpID, typeof config.origin === 'string' ? config.origin : config.origin[0], userId);
  });
  afterEach(async () => {
    await cmQuery(`DELETE FROM ${cmTable('identity_single_use_proofs')} WHERE challenge = ANY($1)`, [challenges]);
    await cmDeleteForUsers(users);
    users.length = 0; challenges.length = 0;
  });
  const registrationOptions = async () => {
    const options = await withAppCmAuth(runner => runner.request(binding => binding.registration.generateRegistrationOptions({
      userId, userName: `${userId}@example.com`, userDisplayName: 'Synthetic user',
    })));
    challenges.push(options.challenge);
    return options;
  };
  const enroll = async () => {
    const options = await registrationOptions();
    const result = await withAppCmAuth(runner => runner.complete('registration', binding => binding.registration.verifyRegistration({
      userId, credential: passkey.registration(options.challenge), expectedChallenge: options.challenge,
    })));
    expect(result).toMatchObject({ committed: true, value: { verified: true } });
    return options;
  };
  const authenticationOptions = async (owner?: string) => {
    const options = await withAppCmAuth(runner => runner.request(binding => binding.authentication.generateAuthenticationOptions({ userId: owner })));
    challenges.push(options.challenge);
    return options;
  };
  const authenticate = (challenge: string, counter = 1) => withAppCmAuth(runner => runner.complete('authentication', binding =>
    binding.authentication.verifyAuthentication({ credential: passkey.assertion(challenge, true, counter), expectedChallenge: challenge })));

  it('persists real COSE material, excludes enrolled credentials and pins required UV', async () => {
    await enroll();
    const stored = await findCmCredentialByCredentialId(passkey.credentialId);
    expect(stored).toMatchObject({ userId, counter: 0, publicKey: passkey.publicKey.toString('base64url') });
    const registration = await registrationOptions();
    expect(registration.excludeCredentials?.map(row => row.id)).toContain(passkey.credentialId);
    expect(registration.authenticatorSelection?.userVerification).toBe('required');
    const bound = await authenticationOptions(userId), discoverable = await authenticationOptions();
    expect(bound.allowCredentials?.map(row => row.id)).toEqual([passkey.credentialId]);
    expect(bound.userVerification).toBe('required');
    expect(discoverable.allowCredentials).toBeUndefined();
    expect(discoverable.userVerification).toBe('required');
  });

  it('commits the counter with challenge consumption and refuses a replay without advancing it', async () => {
    await enroll();
    const options = await authenticationOptions(userId);
    expect(await authenticate(options.challenge)).toMatchObject({ committed: true, value: { verified: true, userId, userVerified: true } });
    expect(await findCmCredentialByCredentialId(passkey.credentialId)).toMatchObject({ counter: 1 });
    expect(await cmQuery(`SELECT state FROM ${cmTable('identity_single_use_proofs')} WHERE challenge = $1`, [options.challenge]))
      .toEqual([{ state: 'consumed' }]);
    expect(await authenticate(options.challenge, 2)).toMatchObject({ committed: false, refusal: { flow: 'authentication', result: { verified: false } } });
    expect(await findCmCredentialByCredentialId(passkey.credentialId)).toMatchObject({ counter: 1 });
  });

  it.each(['expired', 'wrong_owner', 'wrong_purpose', 'missing'] as const)('refuses a %s challenge with no counter mutation', async kind => {
    await enroll();
    const other = randomUUID(); users.push(other);
    await createCmUser({ userId: other, email: `${other}@example.com`, role: 'editor', emailVerified: true });
    const options = kind === 'wrong_purpose' ? await registrationOptions()
      : await authenticationOptions(kind === 'wrong_owner' ? other : userId);
    if (kind === 'expired') await cmQuery(`UPDATE ${cmTable('identity_single_use_proofs')} SET expires_at = $1 WHERE challenge = $2`,
      [new Date(Date.now() - 1_000).toISOString(), options.challenge]);
    const result = await authenticate(kind === 'missing' ? 'unissued-challenge' : options.challenge);
    expect(result).toMatchObject({ committed: false, refusal: { flow: 'authentication', result: { verified: false } } });
    expect(await findCmCredentialByCredentialId(passkey.credentialId)).toMatchObject({ counter: 0 });
    expect(await cmQuery(`SELECT state FROM ${cmTable('identity_single_use_proofs')} WHERE challenge = $1`, [options.challenge]))
      .toEqual([{ state: 'pending' }]);
  });

  it('refuses a stale signed counter while keeping its unused challenge available', async () => {
    await enroll();
    expect(await authenticate((await authenticationOptions(userId)).challenge, 5)).toMatchObject({ committed: true });
    const options = await authenticationOptions(userId);
    expect(await authenticate(options.challenge, 4)).toMatchObject({ committed: false, refusal: { result: { verified: false } } });
    expect(await findCmCredentialByCredentialId(passkey.credentialId)).toMatchObject({ counter: 5 });
    expect(await cmQuery(`SELECT state FROM ${cmTable('identity_single_use_proofs')} WHERE challenge = $1`, [options.challenge]))
      .toEqual([{ state: 'pending' }]);
  });

  it.each([{ origin: 'https://untrusted.invalid' }, { type: 'webauthn.get' }])('refuses registration client data %j before persistence', async client => {
    const options = await registrationOptions();
    const result = await withAppCmAuth(runner => runner.complete('registration', binding => binding.registration.verifyRegistration({
      userId, credential: passkey.registration(options.challenge, true, client), expectedChallenge: options.challenge,
    })));
    expect(result).toMatchObject({ committed: false, refusal: { flow: 'registration', result: { verified: false } } });
    expect(await findCmCredentialByCredentialId(passkey.credentialId)).toBeNull();
    expect(await cmQuery(`SELECT state FROM ${cmTable('identity_single_use_proofs')} WHERE challenge = $1`, [options.challenge]))
      .toEqual([{ state: 'pending' }]);
  });

  it.each(['origin', 'type', 'signature', 'unknown_credential'] as const)('rejects authentication %s evidence without consuming the challenge', async kind => {
    await enroll();
    const options = await authenticationOptions(userId);
    const credential = passkey.assertion(options.challenge, true, 1,
      kind === 'origin' ? { origin: 'https://untrusted.invalid' } : kind === 'type' ? { type: 'webauthn.create' } : {});
    if (kind === 'signature') credential.response.signature = Buffer.alloc(64, 1).toString('base64url');
    if (kind === 'unknown_credential') credential.id = credential.rawId = Buffer.from(randomUUID()).toString('base64url');
    const result = await withAppCmAuth(runner => runner.complete('authentication', binding => binding.authentication.verifyAuthentication({
      credential, expectedChallenge: options.challenge,
    })));
    expect(result).toMatchObject({ committed: false, refusal: { flow: 'authentication', result: { verified: false } } });
    expect(await findCmCredentialByCredentialId(passkey.credentialId)).toMatchObject({ counter: 0 });
    expect(await cmQuery(`SELECT state FROM ${cmTable('identity_single_use_proofs')} WHERE challenge = $1`, [options.challenge]))
      .toEqual([{ state: 'pending' }]);
    expect(await authenticate(options.challenge)).toMatchObject({ committed: true, value: { verified: true } });
  });
});
