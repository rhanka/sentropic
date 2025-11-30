import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import { validateSession } from '../../services/session-manager';
import { db } from '../../db/client';
import { webauthnCredentials } from '../../db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Credential Management Routes
 * 
 * GET /auth/credentials - List user's registered devices
 * PUT /auth/credentials/:id - Update device name
 * DELETE /auth/credentials/:id - Revoke credential
 */

export const credentialsRouter = new Hono();

// Request schemas
const updateCredentialSchema = z.object({
  deviceName: z.string().min(1).max(100),
});

/**
 * GET /auth/credentials
 * List all registered credentials/devices for current user
 */
credentialsRouter.get('/', async (c) => {
  try {
    // Get and validate session
    const sessionToken = 
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return c.json({ error: 'Not authenticated' }, 401);
    }
    
    const session = await validateSession(sessionToken);
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }
    
    // Get user credentials
    const credentials = await db
      .select({
        id: webauthnCredentials.id,
        credentialId: webauthnCredentials.credentialId,
        deviceName: webauthnCredentials.deviceName,
        uv: webauthnCredentials.uv,
        createdAt: webauthnCredentials.createdAt,
        lastUsedAt: webauthnCredentials.lastUsedAt,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, session.userId));
    
    return c.json({ 
      credentials: credentials.map(cred => ({
        ...cred,
        credentialId: cred.credentialId.substring(0, 10) + '...', // Truncate for security
      }))
    });
  } catch (error) {
    logger.error({ err: error }, 'Error listing credentials');
    return c.json({ error: 'Failed to list credentials' }, 500);
  }
});

/**
 * PUT /auth/credentials/:id
 * Update credential device name
 */
credentialsRouter.put('/:id', async (c) => {
  try {
    const credentialId = c.req.param('id');
    
    // Get and validate session
    const sessionToken = 
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return c.json({ error: 'Not authenticated' }, 401);
    }
    
    const session = await validateSession(sessionToken);
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }
    
    // Parse request body
    const body = await c.req.json();
    const { deviceName } = updateCredentialSchema.parse(body);
    
    // Check if credential exists first
    const existingCredential = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.id, credentialId))
      .limit(1);
    
    if (!existingCredential.length) {
      return c.json({ error: 'Credential not found' }, 404);
    }
    
    // Check if credential belongs to user
    if (existingCredential[0].userId !== session.userId) {
      return c.json({ error: 'Access denied' }, 403);
    }
    
    // Update credential
    const [updated] = await db
      .update(webauthnCredentials)
      .set({ deviceName })
      .where(
        and(
          eq(webauthnCredentials.id, credentialId),
          eq(webauthnCredentials.userId, session.userId)
        )
      )
      .returning();
    
    logger.info({ credentialId, userId: session.userId }, 'Credential updated');
    
    return c.json({ success: true, credential: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    logger.error({ err: error }, 'Error updating credential');
    return c.json({ error: 'Failed to update credential' }, 500);
  }
});

/**
 * DELETE /auth/credentials/:id
 * Revoke a credential (delete it)
 */
credentialsRouter.delete('/:id', async (c) => {
  try {
    const credentialId = c.req.param('id');
    
    // Get and validate session
    const sessionToken = 
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return c.json({ error: 'Not authenticated' }, 401);
    }
    
    const session = await validateSession(sessionToken);
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }
    
    // Check if credential exists first
    const existingCredential = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.id, credentialId))
      .limit(1);
    
    if (!existingCredential.length) {
      return c.json({ error: 'Credential not found' }, 404);
    }
    
    // Check if credential belongs to user
    if (existingCredential[0].userId !== session.userId) {
      return c.json({ error: 'Access denied' }, 403);
    }
    
    // Delete credential
    await db
      .delete(webauthnCredentials)
      .where(
        and(
          eq(webauthnCredentials.id, credentialId),
          eq(webauthnCredentials.userId, session.userId)
        )
      )
      .returning({ id: webauthnCredentials.id });
    
    logger.info({ credentialId, userId: session.userId }, 'Credential revoked');
    
    return c.json({ success: true, message: 'Credential revoked successfully' });
  } catch (error) {
    logger.error({ err: error }, 'Error revoking credential');
    return c.json({ error: 'Failed to revoke credential' }, 500);
  }
});

