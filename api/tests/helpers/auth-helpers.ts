import { db } from '../../src/db/client';
import { users, userSessions, webauthnCredentials, webauthnChallenges, magicLinks } from '../../src/db/schema';
import { createSession } from '../../src/services/session-manager';
import type { UserRole } from '../../src/db/schema';

/**
 * Test helpers for authentication integration tests
 */

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  sessionToken?: string;
}

/**
 * Clean up all auth-related data after tests
 */
export async function cleanupAuthData() {
  await db.delete(userSessions);
  await db.delete(webauthnCredentials);
  await db.delete(webauthnChallenges);
  await db.delete(magicLinks);
  await db.delete(users);
}

/**
 * Create a test user with optional session
 */
export async function createTestUser(options: {
  email?: string;
  displayName?: string;
  role?: UserRole;
  withSession?: boolean;
  deviceName?: string;
}): Promise<TestUser> {
  const {
    email = 'test@example.com',
    displayName = 'Test User',
    role = 'guest',
    withSession = false,
    deviceName = 'Test Device'
  } = options;

  const userId = crypto.randomUUID();
  
  // Create user
  await db.insert(users).values({
    id: userId,
    email,
    displayName,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  let sessionToken: string | undefined;

  // Create session if requested
  if (withSession) {
    const session = await createSession(userId, deviceName);
    sessionToken = session.sessionToken;
  }

  return {
    id: userId,
    email,
    displayName,
    role,
    sessionToken,
  };
}

/**
 * Create a mock WebAuthn credential for testing
 */
export async function createMockCredential(userId: string, deviceName: string = 'Test Device') {
  const credentialId = crypto.randomUUID();
  const uniqueCredentialId = `mock-credential-${credentialId}-base64`;
  
  await db.insert(webauthnCredentials).values({
    id: credentialId,
    credentialId: uniqueCredentialId,
    userId,
    deviceName,
    publicKeyCose: Buffer.from('mock-public-key-data').toString('base64'),
    counter: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return credentialId;
}

/**
 * Create mock WebAuthn registration options response
 */
export function createMockRegistrationOptions() {
  return {
    challenge: 'mock-challenge-base64',
    rp: {
      id: 'localhost',
      name: 'Top AI Ideas',
    },
    user: {
      id: 'mock-user-id',
      name: 'testuser',
      displayName: 'Test User',
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'preferred',
      residentKey: 'preferred',
    },
    attestation: 'direct',
    timeout: 60000,
  };
}

/**
 * Create mock WebAuthn authentication options response
 */
export function createMockAuthenticationOptions() {
  return {
    challenge: 'mock-challenge-base64',
    timeout: 60000,
    rpId: 'localhost',
    allowCredentials: [
      {
        type: 'public-key',
        id: 'mock-credential-id',
        transports: ['internal'],
      },
    ],
    userVerification: 'preferred',
  };
}

/**
 * Create mock WebAuthn credential response for registration
 */
export function createMockRegistrationResponse() {
  return {
    id: 'mock-credential-id',
    rawId: 'mock-raw-id',
    response: {
      clientDataJSON: 'mock-client-data',
      attestationObject: 'mock-attestation-object',
    },
    type: 'public-key',
  };
}

/**
 * Create mock WebAuthn credential response for authentication
 */
export function createMockAuthenticationResponse() {
  return {
    id: 'mock-credential-id',
    rawId: 'mock-raw-id',
    response: {
      clientDataJSON: 'mock-client-data',
      authenticatorData: 'mock-authenticator-data',
      signature: 'mock-signature',
      userHandle: 'mock-user-handle',
    },
    type: 'public-key',
  };
}

/**
 * Make authenticated API request with session cookie
 */
export async function authenticatedRequest(
  app: any,
  method: string,
  path: string,
  sessionToken: string,
  body?: any
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (sessionToken) {
    headers['Cookie'] = `session=${sessionToken}`;
  }

  const requestOptions: RequestInit = {
    method,
    headers,
  };

  if (body) {
    requestOptions.body = JSON.stringify(body);
  }

  return app.request(path, requestOptions);
}
