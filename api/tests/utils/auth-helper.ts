import { db } from '../../src/db/client';
import { workspaces, ADMIN_WORKSPACE_ID } from '../../src/db/schema';
import { createSession } from '../../src/services/session-manager';
import { verifyEmailCode } from '../../src/services/email-verification';
import { createCmUser } from '../../src/services/identity/cm-users';
import { createCmCredential, createCmEmailCode, sha256Hex } from '../../src/services/identity/cm-proofs';
import { enrolCmWorkspace, putCmWorkspaceMember } from '../../src/services/identity/cm-tenancy';
import { PLATFORM_TENANT_ID } from '../../src/services/workspace-service';
import { getWebAuthnConfig } from '../../src/services/webauthn-config';
import { cmDeleteForEmails, cmDeleteForUsers } from './cm-identity-test-store';

/**
 * Test helpers for authentication integration tests.
 *
 * Lot A4: identity fixtures live in the cluster-mesh cm_identity stores; the
 * legacy public.users/userSessions/webauthn*/magicLinks/emailVerificationCodes/
 * workspaceMemberships tables no longer exist.
 */

export type UserRole = 'guest' | 'editor' | 'admin_org' | 'admin_app';

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  sessionToken?: string;
  workspaceId?: string | null;
}

type TrackedAuthScope = {
  userIds: Set<string>;
  emails: Set<string>;
};

const DEFAULT_TRACKED_AUTH_OWNER = '__default__';
const trackedAuthScopes = new Map<string, TrackedAuthScope>();

function uniqueTestEmail(role: UserRole): string {
  const worker = process.env.VITEST_WORKER_ID || 'w0';
  return `${role}-${worker}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function resolveTrackedAuthOwner(): string {
  const explicitOwner = process.env.TEST_CLEANUP_OWNER?.trim();
  if (explicitOwner) return explicitOwner;

  const stack = new Error().stack ?? '';
  const lines = stack.split('\n');

  for (const line of lines) {
    const match = line.match(/(\/app\/tests\/[^\s)]+|\/[^:\s)]+\/tests\/[^\s)]+|tests\/[^\s)]+)/);
    const candidate = match?.[1];
    if (!candidate) continue;
    if (candidate.endsWith('/utils/auth-helper.ts')) continue;
    return candidate;
  }

  return `${DEFAULT_TRACKED_AUTH_OWNER}:${process.env.VITEST_WORKER_ID || 'w0'}`;
}

function getTrackedAuthScope(owner = resolveTrackedAuthOwner()): TrackedAuthScope {
  const existing = trackedAuthScopes.get(owner);
  if (existing) return existing;
  const created: TrackedAuthScope = {
    userIds: new Set<string>(),
    emails: new Set<string>(),
  };
  trackedAuthScopes.set(owner, created);
  return created;
}


/**
 * Clean up all auth-related data after tests
 */
export async function cleanupAuthData() {
  if (process.env.TEST_CLEANUP_SCOPE !== 'tracked') {
    const { cmPurgeAllIdentity } = await import('./cm-identity-test-store');
    await cmPurgeAllIdentity();
    return;
  }

  const owner = resolveTrackedAuthOwner();
  const scope = trackedAuthScopes.get(owner);
  if (!scope || (scope.userIds.size === 0 && scope.emails.size === 0)) {
    return;
  }

  const userIds = Array.from(scope.userIds);
  const emails = Array.from(scope.emails);
  trackedAuthScopes.delete(owner);

  await cmDeleteForEmails(emails);
  await cmDeleteForUsers(userIds);
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
  emailVerified?: boolean;
  withWorkspace?: boolean;
}): Promise<TestUser> {
  const {
    email,
    displayName = 'Test User',
    role = 'guest',
    withSession = false,
    deviceName = 'Test Device',
    emailVerified = true, // Default to verified for tests
    withWorkspace = true,
  } = options;
  const resolvedEmail = email ?? uniqueTestEmail(role);

  const userId = crypto.randomUUID();

  // Create user in the CM identity store
  await createCmUser({
    userId,
    email: resolvedEmail,
    displayName,
    role,
    emailVerified,
    accountStatus: 'active',
  });
  const trackedScope = getTrackedAuthScope();
  trackedScope.userIds.add(userId);
  trackedScope.emails.add(resolvedEmail);

  let sessionToken: string | undefined;
  let workspaceId: string | null = null;

  if (withWorkspace && role !== 'admin_app') {
    workspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: workspaceId,
      name: `Test Workspace ${workspaceId.slice(0, 6)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await enrolCmWorkspace({ workspaceId, tenantId: PLATFORM_TENANT_ID });
    await putCmWorkspaceMember(
      workspaceId,
      userId,
      role === 'guest' ? 'viewer' : role === 'editor' ? 'editor' : 'admin',
    );
  } else if (role === 'admin_app') {
    workspaceId = ADMIN_WORKSPACE_ID;
  }

  // Create session if requested
  if (withSession) {
    const session = await createSession(userId, role, { name: deviceName });
    sessionToken = session.sessionToken;
  }

  return {
    id: userId,
    email: resolvedEmail,
    displayName,
    role,
    sessionToken,
    workspaceId,
  };
}

/**
 * Create an authenticated user with session for testing
 */
export async function createAuthenticatedUser(role: UserRole = 'guest', email?: string): Promise<TestUser> {
  return createTestUser({
    email: email || uniqueTestEmail(role),
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
    createAuthenticatedUser('admin_app'),
    createAuthenticatedUser('editor'),
    createAuthenticatedUser('guest'),
  ]);

  return { admin, editor, guest };
}

/**
 * Create a mock WebAuthn credential for testing
 */
export async function createMockCredential(userId: string, deviceName: string = 'Test Device') {
  const credentialId = crypto.randomUUID();
  const uniqueCredentialId = `mock-credential-${credentialId}-base64`;

  const created = await createCmCredential({
    userId,
    credentialId: uniqueCredentialId,
    publicKey: Buffer.from('mock-public-key-data').toString('base64'),
    counter: 0,
    name: deviceName,
    rpId: getWebAuthnConfig().rpID,
    now: new Date(),
  });

  return created.id;
}

/**
 * Create mock WebAuthn registration options response
 */
export function createMockRegistrationOptions() {
  return {
    challenge: 'mock-challenge-base64',
    rp: {
      id: 'localhost',
      name: 'Sentropic',
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
  await cmDeleteForUsers([userId]);
}

/**
 * Get authorization headers for test requests (legacy function for compatibility)
 */
export function getAuthHeaders(sessionToken: string): Record<string, string> {
  return {
    Cookie: `session=${sessionToken}`,
  };
}

/**
 * Generate a verification token for testing (simulates email verification flow)
 * This creates a valid verification token that can be used in registration tests
 */
export async function generateTestVerificationToken(email: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const testCode = '123456';
  const codeHash = sha256Hex(testCode);

  // Keep tests deterministic and parallel-safe by bypassing runtime rate-limits.
  await cmDeleteForEmails([normalizedEmail]);

  await createCmEmailCode({
    email: normalizedEmail,
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    now: new Date(),
  });

  // Now verify the code to get the token
  const result = await verifyEmailCode({ email, code: testCode });

  if (!result.valid || !result.verificationToken) {
    throw new Error('Failed to generate verification token for test');
  }

  return result.verificationToken;
}
