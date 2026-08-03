import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/app';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { seedCoworkDevice } from '../utils/cowork-device';

describe('Cowork device lease delivery', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });
  afterEach(cleanupAuthData);

  async function issue(deviceId: string, turnRef: string) {
    const response = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/leases', user.sessionToken!, {
      device_id: deviceId, turn_ref: turnRef, scope: { capability: 'screen_capture' },
    });
    expect(response.status).toBe(201);
    return (await response.json() as { lease: { leaseId: string } }).lease.leaseId;
  }

  it('emits only the subscribed device durable queue over SSE', async () => {
    const target = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const sibling = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const targetLease = await issue(target.deviceId, 'target-turn');
    const siblingLease = await issue(sibling.deviceId, 'sibling-turn');

    const abort = new AbortController();
    const response = await app.request(
      `/api/v1/streams/cowork-devices/${target.deviceId}/leases/sse`,
      { headers: { Authorization: `Bearer ${user.sessionToken}` }, signal: abort.signal },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader!.read();
    const event = new TextDecoder().decode(first.value);
    expect(event).toContain(targetLease);
    expect(event).not.toContain(siblingLease);
    await reader!.cancel();
    abort.abort();
  });

  it('rejects a lease stream for a device the caller does not own', async () => {
    const ownerDevice = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const other = await createAuthenticatedUser('editor');
    const response = await app.request(
      `/api/v1/streams/cowork-devices/${ownerDevice.deviceId}/leases/sse`,
      { headers: { Authorization: `Bearer ${other.sessionToken}` } },
    );
    expect(response.status).toBe(404);
  });
});
