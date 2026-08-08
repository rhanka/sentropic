import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { workspaceMemberships, workspaces } from '../../src/db/schema';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser, unauthenticatedRequest } from '../utils/auth-helper';
import { createTestCoworkKey } from '../utils/cowork-device';

describe('Cowork workspace exposure public route', () => {
  let conductor: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let workspaceId: string;

  beforeEach(async () => {
    conductor = await createAuthenticatedUser('admin_app');
    workspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, ownerUserId: conductor.id, name: 'Cowork UAT workspace' });
    await db.insert(workspaceMemberships).values({ workspaceId, userId: conductor.id, role: 'admin' });
  });
  afterEach(cleanupAuthData);

  it('provisions, enrolls, grants, selects, invokes, and revokes through public routes', async () => {
    const key = createTestCoworkKey();
    expect((await authenticatedRequest(app, 'POST', '/api/v1/auth/device/provision', conductor.sessionToken!, {
      devicePublicKey: key.publicKey, kioskSurface: 'notepad',
    })).status).toBe(200);
    const codeResponse = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/code', {
      deviceName: 'Cowork UAT', deviceId: key.deviceId, devicePublicKey: key.publicKey,
      capabilities: ['screen_capture', 'input_action'],
    });
    expect(codeResponse.status).toBe(200);
    const code = await codeResponse.json() as { device_code: string; user_code: string; server_nonce: string };
    expect((await authenticatedRequest(app, 'POST', '/api/v1/auth/device/approve', conductor.sessionToken!, {
      user_code: code.user_code,
    })).status).toBe(200);
    const enrollment = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/device/poll', {
      device_code: code.device_code, proof: key.signPayload(`cowork-enroll-v1:${code.device_code}.${code.server_nonce}`),
    });
    expect(enrollment.status).toBe(200);
    const deviceSession = (await enrollment.json() as { sessionToken: string }).sessionToken;

    expect((await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/tabs/register', deviceSession, {
      source: 'desktop_cowork', device_id: key.deviceId,
    })).status).toBe(200);
    const granted = await authenticatedRequest(app, 'POST', '/api/v1/auth/device/cowork-exposure', conductor.sessionToken!, {
      action: 'grant', device_id: key.deviceId, workspace_id: workspaceId, capabilities: ['screen_capture'],
    });
    expect(granted.status).toBe(200);
    await expect(granted.json()).resolves.toMatchObject({ granted_by: conductor.id, capabilities: ['screen_capture'] });
    expect((await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/selection', deviceSession, {
      session_id: 'cowork-public-route', workspace_id: workspaceId, device_id: key.deviceId,
    })).status).toBe(200);
    expect((await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/leases', deviceSession, {
      device_id: key.deviceId, turn_ref: 'public-route-invoke', session_id: 'cowork-public-route',
      workspace_id: workspaceId, scope: { capability: 'screen_capture' },
    })).status).toBe(201);

    expect((await authenticatedRequest(app, 'POST', '/api/v1/auth/device/cowork-exposure', conductor.sessionToken!, {
      action: 'revoke', device_id: key.deviceId, workspace_id: workspaceId, capabilities: ['screen_capture'],
    })).status).toBe(200);
    expect((await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/leases', deviceSession, {
      device_id: key.deviceId, turn_ref: 'revoked-public-route', session_id: 'cowork-public-route',
      workspace_id: workspaceId, scope: { capability: 'screen_capture' },
    })).status).toBe(403);
  });
});
