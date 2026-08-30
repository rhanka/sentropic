import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import { validateSession } from '../../services/session-manager';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

/**
 * Device-Code Enrollment Routes (RFC 8628-style)
 *
 * A headless binary (Sentropic Cowork) has no browser session cookie, so it uses a
 * device-code handshake that ends by minting the same session token pair as the
 * Chrome extension (`session-manager.createSession`).
 *
 * POST /auth/device/code    - issue a pending device code (no auth)
 * POST /auth/device/poll    - poll for approval (no auth); returns token pair on approval
 * POST /auth/device/approve - link a pending user_code to the authenticated user (auth required)
 */

export const deviceRouter = new Hono();

const approveSchema = z.object({
  user_code: z.string().min(1),
  device_name: z.string().min(1).max(100).optional(),
});

/**
 * POST /auth/device/approve
 * Link a pending user_code to the authenticated user, recording the device name.
 * Requires the user's app session (cookie or bearer).
 */
deviceRouter.post('/approve', async (c) => {
  try {
    const sessionToken =
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');

    if (!sessionToken) {
      return c.json({ error: 'No session token provided' }, 401);
    }

    const session = await validateSession(sessionToken);
    if (!session) {
      return c.json({ error: 'Invalid or expired session' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const { user_code, device_name } = approveSchema.parse(body);

    const result = clusterMeshAdapter.devices.approveDeviceCode(
      user_code,
      session.userId,
      session.role,
      device_name,
    );

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return c.json({ error: 'Invalid or expired code' }, 404);
      }
      if (result.reason === 'expired') {
        return c.json({ error: 'Code expired' }, 410);
      }
      return c.json({ error: 'Code already resolved' }, 409);
    }

    return c.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    logger.error({ err: error }, 'Error approving device code');
    return c.json({ error: 'Failed to approve device code' }, 500);
  }
});
