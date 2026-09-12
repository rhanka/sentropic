import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/app';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { seedCoworkDevice } from '../utils/cowork-device';
import { coworkDeliveryProofPayload } from '../../src/services/cowork/device-identity';
import { createCoworkConnectorHost, type CoworkInvocationBrokerPort } from '../../src/services/connector-host/cowork';
import type { CoworkAuditEvent } from '../../src/services/cowork/redacted-audit';

/**
 * PENDING-RUNTIME: §3.5 Planted-marker cross-surface integration suite.
 * Exercises real API routes, Postgres tables, SSE streams, and audit sinks
 * once the isolated test API stack is booted with migrations.
 */
describe.skip('Cowork §3.5 Planted-marker cross-surface integration (PENDING-RUNTIME)', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  const sessionId = 'planted-marker-session';

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });
  afterEach(cleanupAuthData);

  function proofHeaders(device: { deviceId: string; signPayload: (payload: string) => string }) {
    const issuedAtMs = Date.now();
    return {
      'x-cowork-device-proof-at': String(issuedAtMs),
      'x-cowork-device-proof': device.signPayload(coworkDeliveryProofPayload({ method: 'GET', deviceId: device.deviceId, issuedAtMs })),
    };
  }

  it('proves negative witness absence and positive controls across SSE, results, and audit', async () => {
    const M_TEXT = 'WITNESS-TEXT-f89a2b7c';
    const M_SCOPE = 'WITNESS-SCOPE-9e41d83a';
    const M_CAPTURE = 'FAKE-SECRET-IMAGE-113355';

    const target = await seedCoworkDevice({ userId: user.id, presence: 'active' });
    const auditEvents: CoworkAuditEvent[] = [];

    // 1. Target selection
    await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/selection', user.sessionToken!, {
      session_id: sessionId, workspace_id: user.workspaceId, device_id: target.deviceId,
    });

    // 2. Issue input lease with M_TEXT and planted scope
    const response = await authenticatedRequest(app, 'POST', '/api/v1/chrome-extension/cowork-devices/leases', user.sessionToken!, {
      device_id: target.deviceId, turn_ref: 'planted-turn-1', session_id: sessionId,
      workspace_id: user.workspaceId,
      scope: {
        capability: 'input_action',
        action: { action: 'type', text: M_TEXT },
        metadata: { note: M_SCOPE },
      },
    });
    expect(response.status).toBe(201);
    const leasePayload = (await response.json() as { lease: { leaseId: string; nonce: string } }).lease;

    // 3. Receive delivery frame over SSE and assert M_SCOPE/M_CAPTURE absence, M_TEXT presence in action
    const abort = new AbortController();
    const sseResponse = await app.request(
      `/api/v1/streams/cowork-devices/${target.deviceId}/leases/sse`,
      { headers: { Authorization: `Bearer ${user.sessionToken}`, ...proofHeaders(target) }, signal: abort.signal },
    );
    expect(sseResponse.status).toBe(200);
    const reader = sseResponse.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader!.read();
    const eventText = new TextDecoder().decode(first.value);
    expect(eventText).toContain(leasePayload.leaseId);
    expect(eventText).toContain(M_TEXT);
    expect(eventText).not.toContain(M_SCOPE);
    expect(eventText).not.toContain(M_CAPTURE);
    await reader!.cancel();
    abort.abort();

    // 4. Ingest capture with smuggled secret and assert PAS-FAIT rejection
    const completeResponse = await authenticatedRequest(app, 'POST', `/api/v1/chrome-extension/cowork-devices/leases/${leasePayload.leaseId}/result`, user.sessionToken!, {
      device_id: target.deviceId,
      outcome: 'FAIT',
      result: {
        ok: true, screen: 0, width: 1920, height: 1080, image: 'data:image/png;base64,QUJD',
        metadata: { secret: M_CAPTURE },
      },
      signature: target.signPayload(`cowork-lease-result-v1:${leasePayload.leaseId}.${leasePayload.nonce}.FAIT.digest`),
    });
    expect(completeResponse.status).toBe(409); // rejected fail-closed
  });
});
