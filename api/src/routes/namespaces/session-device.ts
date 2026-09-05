import type { DeviceRouteHandlers } from '@sentropic/cluster-mesh';
import { z } from 'zod';
import { logger } from '../../logger';
import { findSessionUser } from '../../services/auth/session-adapter';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import { createSession, validateSession } from '../../services/session-manager';

const issueSchema = z.object({ deviceName: z.string().min(1).max(100).optional() });
const pollSchema = z.object({ device_code: z.string().min(1) });
const approveSchema = z.object({
  user_code: z.string().min(1),
  device_name: z.string().min(1).max(100).optional(),
});
const DEVICE_CODE_TTL_SEC = 10 * 60;

export const sessionDeviceHandlers: DeviceRouteHandlers = {
  async issue(c) {
    try {
      const { deviceName } = issueSchema.parse(await c.req.json().catch(() => ({})));
      const issued = clusterMeshAdapter.devices.issueDeviceCode(deviceName);
      const origin = (c.req.header('origin') || '').trim();
      return c.json({
        device_code: issued.deviceCode,
        user_code: issued.userCode,
        verification_uri: origin ? `${origin}/auth/devices/pair` : '/auth/devices/pair',
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
  },

  async poll(c) {
    try {
      const { device_code } = pollSchema.parse(await c.req.json().catch(() => ({})));
      const outcome = clusterMeshAdapter.devices.pollDeviceCode(device_code);
      if (outcome.status !== 'approved') return c.json({ status: outcome.status });
      const issued = await createSession(outcome.userId, outcome.role, {
        name: outcome.deviceName,
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || undefined,
        userAgent: c.req.header('user-agent') || undefined,
      });
      const user = await findSessionUser(outcome.userId);
      if (!user) throw new Error('Device enrollment user lookup returned no row');
      await clusterMeshAdapter.completeDeviceAttachment(outcome, issued);
      return c.json({
        status: 'approved',
        sessionToken: issued.sessionToken,
        refreshToken: issued.refreshToken,
        expiresAt: issued.expiresAt.toISOString(),
        user: {
          id: outcome.userId,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.errors }, 400);
      }
      logger.error({ err: error }, 'Error polling device code');
      return c.json({ error: 'Failed to poll device code' }, 500);
    }
  },

  async approve(c) {
    try {
      const sessionToken = c.req.header('cookie')?.match(/session=([^;]+)/)?.[1]
        ?? c.req.header('authorization')?.replace('Bearer ', '');
      if (!sessionToken) return c.json({ error: 'No session token provided' }, 401);
      const session = await validateSession(sessionToken);
      if (!session) return c.json({ error: 'Invalid or expired session' }, 401);
      const body = approveSchema.parse(await c.req.json().catch(() => ({})));
      const result = clusterMeshAdapter.devices.approveDeviceCode(
        body.user_code, session.userId, session.role, body.device_name,
      );
      if (!result.ok) {
        if (result.reason === 'not_found') return c.json({ error: 'Invalid or expired code' }, 404);
        if (result.reason === 'expired') return c.json({ error: 'Code expired' }, 410);
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
  },
};
