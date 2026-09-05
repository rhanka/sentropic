import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  completeDeviceAttachment: vi.fn(),
  createSession: vi.fn(),
  ensureDeviceAttachmentAvailable: vi.fn(),
  pollDeviceCode: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock('../../src/services/session-manager', () => ({
  createSession: doubles.createSession,
  validateSession: vi.fn(),
}));

vi.mock('../../src/services/cluster-mesh-adapter', () => ({
  clusterMeshAdapter: {
    completeDeviceAttachment: doubles.completeDeviceAttachment,
    ensureDeviceAttachmentAvailable: doubles.ensureDeviceAttachmentAvailable,
    devices: {
      approveDeviceCode: vi.fn(),
      issueDeviceCode: vi.fn(),
      pollDeviceCode: doubles.pollDeviceCode,
    },
  },
}));

vi.mock('../../src/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: doubles.selectLimit })),
      })),
    })),
  },
}));

import { sessionDeviceHandlers } from '../../src/routes/namespaces/session-device';

const deviceRouter = new Hono().post('/poll', sessionDeviceHandlers.poll);

describe('device enrollment route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doubles.ensureDeviceAttachmentAvailable.mockResolvedValue(undefined);
    doubles.pollDeviceCode.mockReturnValue({
      status: 'approved',
      userId: 'deleted-user',
      role: 'editor',
      deviceName: 'Orphan Laptop',
    });
    doubles.createSession.mockResolvedValue({
      sessionToken: 'session-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-08-16T00:00:00Z'),
    });
    doubles.selectLimit.mockResolvedValue([]);
  });

  it('does not attach an approved workstation when the user lookup returns no row', async () => {
    const response = await deviceRouter.request('/poll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: 'approved-code' }),
    });

    expect(response.status).toBe(500);
    expect(doubles.createSession).not.toHaveBeenCalled();
    expect(doubles.completeDeviceAttachment).not.toHaveBeenCalled();
  });

  it('should refuse a fenced generation before consuming the device code or creating a session', async () => {
    doubles.ensureDeviceAttachmentAvailable.mockRejectedValueOnce(
      new Error('cluster_mesh_generation_unavailable'),
    );

    const response = await deviceRouter.request('/poll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: 'approved-code' }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'cluster_mesh_generation_unavailable' });
    expect(doubles.pollDeviceCode).not.toHaveBeenCalled();
    expect(doubles.createSession).not.toHaveBeenCalled();
    expect(doubles.completeDeviceAttachment).not.toHaveBeenCalled();
  });
});
