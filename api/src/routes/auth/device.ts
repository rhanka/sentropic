import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import { validateSession, createSession } from '../../services/session-manager';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';

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

const issueSchema = z.object({
  deviceName: z.string().min(1).max(100).optional(),
});

const pollSchema = z.object({
  device_code: z.string().min(1),
});

const approveSchema = z.object({
  user_code: z.string().min(1),
  device_name: z.string().min(1).max(100).optional(),
});

const DEVICE_CODE_TTL_SEC = 10 * 60;

/**
 * POST /auth/device/code
 * Issue a short-lived single-use device code. No auth — the binary is not yet enrolled.
 */
deviceRouter.post('/code', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { deviceName } = issueSchema.parse(body);

    const issued = clusterMeshAdapter.devices.issueDeviceCode(deviceName);

    const origin = (c.req.header('origin') || '').trim();
    const verificationUri = origin ? `${origin}/auth/devices/pair` : '/auth/devices/pair';

    return c.json({
      device_code: issued.deviceCode,
      user_code: issued.userCode,
      verification_uri: verificationUri,
      interval: issued.intervalSec,
      expires_in: DEVICE_CODE_TTL_SEC,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    logger.error({ err: error }, 'Error issuing device code');
    return c.json({ error: 'Failed to issue device code' }, 500);
  }
});

/**
 * POST /auth/device/poll
 * Poll a device code. No auth. Returns the token pair once approved (single-use).
 */
deviceRouter.post('/poll', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { device_code } = pollSchema.parse(body);

    const outcome = clusterMeshAdapter.devices.pollDeviceCode(device_code);

    if (outcome.status === 'approved') {
      const issued = await createSession(outcome.userId, outcome.role, {
        name: outcome.deviceName,
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || undefined,
        userAgent: c.req.header('user-agent') || undefined,
      });

      const [userRecord] = await db
        .select({
          email: users.email,
          displayName: users.displayName,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, outcome.userId))
        .limit(1);

      clusterMeshAdapter.completeDeviceAttachment(outcome);

      return c.json({
        status: 'approved',
        sessionToken: issued.sessionToken,
        refreshToken: issued.refreshToken,
        expiresAt: issued.expiresAt.toISOString(),
        user: {
          id: outcome.userId,
          email: userRecord?.email ?? null,
          displayName: userRecord?.displayName ?? null,
          role: userRecord?.role ?? outcome.role,
        },
      });
    }

    return c.json({ status: outcome.status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    logger.error({ err: error }, 'Error polling device code');
    return c.json({ error: 'Failed to poll device code' }, 500);
  }
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
