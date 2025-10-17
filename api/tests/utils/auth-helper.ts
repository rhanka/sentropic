import { db } from '../../src/db/client';
import { users, userSessions, webauthnCredentials, webauthnChallenges, magicLinks } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
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
    const session = await createSession(userId, role, { deviceName });
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
 * Create an authenticated user with session for testing
 */
export async function createAuthenticatedUser(role: UserRole = 'guest', email?: string): Promise<TestUser> {
  return createTestUser({
    email: email || `${role}@example.com`,
    displayName: `${role.charAt(0).toUpperCase() + role.slice(1)} User`,
    role,
    withSession: true,
  });
}

/**
 * Create multiple users with different roles for testing permissions
 */
export async function createTestUsersWithRoles(): Promise<{
  admin: TestUser;
  editor: TestUser;
  guest: TestUser;
}> {
  const [admin, editor, guest] = await Promise.all([
    createAuthenticatedUser('admin_app', 'admin@example.com'),
    createAuthenticatedUser('editor', 'editor@example.com'),
    createAuthenticatedUser('guest', 'guest@example.com'),
  ]);

  return { admin, editor, guest };
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
  body?: any,
  headers?: Record<string, string>
) {
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers, // Merge custom headers
  };

  if (sessionToken) {
    requestHeaders['Cookie'] = `session=${sessionToken}`;
  }

  const requestOptions: RequestInit = {
    method,
    headers: requestHeaders,
  };

  if (body && method !== 'GET' && method !== 'HEAD') {
    requestOptions.body = JSON.stringify(body);
  }

  return app.request(path, requestOptions);
}

/**
 * Make unauthenticated API request (for testing 401 responses)
 */
export async function unauthenticatedRequest(
  app: any,
  method: string,
  path: string,
  body?: any,
  headers?: Record<string, string>
) {
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers, // Merge custom headers
  };

  const requestOptions: RequestInit = {
    method,
    headers: requestHeaders,
  };

  if (body && method !== 'GET' && method !== 'HEAD') {
    requestOptions.body = JSON.stringify(body);
  }

  return app.request(path, requestOptions);
}

/**
 * Clean up test user and sessions (legacy function for compatibility)
 */
export async function cleanupTestUser(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
  // Sessions will be deleted via CASCADE
}

/**
 * Get authorization headers for test requests (legacy function for compatibility)
 */
export function getAuthHeaders(sessionToken: string): Record<string, string> {
  return {
    Cookie: `session=${sessionToken}`,
  };
}

