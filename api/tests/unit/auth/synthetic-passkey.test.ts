import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { expect, it } from 'vitest';
import { createSyntheticPasskey } from '../../utils/synthetic-passkey';

it('uses a real P-256 signature and public COSE material accepted by the actual verifier', async () => {
  const fixture = createSyntheticPasskey('localhost', 'http://localhost:5173', 'synthetic-user');
  const options = { expectedChallenge: 'challenge', expectedOrigin: 'http://localhost:5173', expectedRPID: 'localhost',
    requireUserVerification: true, credential: { id: fixture.credentialId, publicKey: fixture.publicKey, counter: 0 } };
  expect(await verifyAuthenticationResponse({ ...options, response: fixture.assertion('challenge', true) }))
    .toMatchObject({ verified: true, authenticationInfo: { userVerified: true, newCounter: 1 } });
  await expect(verifyAuthenticationResponse({ ...options, response: fixture.assertion('challenge', false) }))
    .rejects.toThrow();
  expect(await verifyRegistrationResponse({ expectedChallenge: 'registration-challenge',
    expectedOrigin: options.expectedOrigin, expectedRPID: options.expectedRPID, requireUserVerification: true,
    response: fixture.registration('registration-challenge') }))
    .toMatchObject({ verified: true, registrationInfo: { userVerified: true, credential: { id: fixture.credentialId } } });
});
