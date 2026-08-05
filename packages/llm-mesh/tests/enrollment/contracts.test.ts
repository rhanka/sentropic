import { describe, expect, it } from 'vitest';
import type {
  EnrollmentProvider,
  EnrollmentSession,
  EnrollmentState,
  PreparedCredential,
  ResolvedProviderMetadata,
  StartEnrollmentInput,
} from '../../src/enrollment/contracts.js';

describe('enrollment contracts', () => {
  it('instantiates authorization-url and device-code enrollment sessions', () => {
    const authUrlSession: EnrollmentSession = {
      kind: 'authorization-url',
      enrollmentId: 'enr_123',
      url: 'https://auth.example.com/oauth',
      expiresAt: '2026-12-31T23:59:59Z',
    };

    const deviceCodeSession: EnrollmentSession = {
      kind: 'device-code',
      enrollmentId: 'enr_456',
      verificationUrl: 'https://auth.example.com/device',
      userCode: 'ABCD-1234',
      pollIntervalMs: 5000,
      expiresAt: '2026-12-31T23:59:59Z',
    };

    expect(authUrlSession.kind).toBe('authorization-url');
    expect(deviceCodeSession.kind).toBe('device-code');
  });

  it('allows building valid input and state contracts', () => {
    const startInput: StartEnrollmentInput = {
      configRef: 'vault://cloud-code/client-config',
      mode: 'cli',
      redirectUri: 'http://127.0.0.1:8080/callback',
      ownerScope: 'cli:localhost',
    };

    const state: EnrollmentState = {
      enrollmentId: '01HKEY1234567890ABCDEFGHJK',
      providerId: 'cloud-code',
      ownerScope: 'cli:localhost',
      pkceVerifier: 'verifier_secret',
      pkceState: 'csrf_nonce',
      redirectUri: 'http://127.0.0.1:8080/callback',
      configVersion: 'v1.0',
      createdAt: '2026-08-04T00:00:00Z',
      expiresAt: '2026-08-04T00:15:00Z',
    };

    const credential: PreparedCredential = {
      accountId: '01HKEY9876543210ABCDEFGHJK',
      accessToken: 'access_token_123',
      refreshToken: 'refresh_token_456',
      expiresAt: '2026-08-04T01:00:00Z',
      authClientConfigVersion: 'v1.0',
    };

    const metadata: ResolvedProviderMetadata = {
      cloudaicompanionProject: 'my-project-123',
      cloudCodeUserAgentVersion: '1.1.10',
    };

    expect(startInput.mode).toBe('cli');
    expect(state.providerId).toBe('cloud-code');
    expect(credential.accountId).toBeTruthy();
    expect(metadata.cloudaicompanionProject).toBe('my-project-123');
  });

  it('supports mock EnrollmentProvider implementations', async () => {
    const mockProvider: EnrollmentProvider = {
      async start(input) {
        return {
          kind: 'authorization-url',
          enrollmentId: 'enr_mock',
          url: `${input.redirectUri}?state=mock`,
          expiresAt: '2026-12-31T23:59:59Z',
        };
      },
      async complete(input) {
        return {
          accountId: 'acct_mock',
          accessToken: `token_for_${input.code}`,
          expiresAt: '2026-12-31T23:59:59Z',
          authClientConfigVersion: 'v1',
        };
      },
      async resolve(cred) {
        return {
          cloudaicompanionProject: `project_${cred.accountId}`,
        };
      },
      async refresh(input) {
        return {
          accountId: input.accountId,
          accessToken: 'refreshed_token',
          expiresAt: '2026-12-31T23:59:59Z',
          authClientConfigVersion: input.credentialVersion,
        };
      },
    };

    const session = await mockProvider.start({
      configRef: 'ref',
      mode: 'cli',
      redirectUri: 'http://localhost/cb',
      ownerScope: 'test',
    });
    expect(session.enrollmentId).toBe('enr_mock');

    const cred = await mockProvider.complete({ enrollmentId: session.enrollmentId, code: '12345' });
    expect(cred.accessToken).toBe('token_for_12345');

    const meta = await mockProvider.resolve(cred);
    expect(meta.cloudaicompanionProject).toBe('project_acct_mock');
  });
});
