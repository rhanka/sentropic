import { db } from '../../src/db/client';
import { users } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createSession } from '../../src/services/session-manager';

/**
 * Test helpers for authentication
 */

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin_app' | 'admin_org' | 'editor' | 'guest';
  sessionToken: string;
  refreshToken: string;
}

/**
 * Create a test user with session for testing protected routes
 */
export async function createTestUser(
  role: 'admin_app' | 'admin_org' | 'editor' | 'guest' = 'editor'
): Promise<TestUser> {
  const userId = crypto.randomUUID();
  const email = `test-${userId.substring(0, 8)}@example.com`;
  
  // Create user in database
  await db.insert(users).values({
    id: userId,
    email,
    displayName: `Test User ${role}`,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  
  // Create session
  const { sessionToken, refreshToken } = await createSession(userId, role);
  
  return {
    id: userId,
    email,
    displayName: `Test User ${role}`,
    role,
    sessionToken,
    refreshToken,
  };
}

/**
 * Clean up test user and sessions
 */
export async function cleanupTestUser(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
  // Sessions will be deleted via CASCADE
}

/**
 * Get authorization headers for test requests
 */
export function getAuthHeaders(sessionToken: string): Record<string, string> {
  return {
    Cookie: `session=${sessionToken}`,
  };
}

