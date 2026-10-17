import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSeatDeliveryRouter } from '../../src/routes/namespaces/llm-seat-delivery';
import { acquireClaudeCodeAccountTransport } from '../../src/services/llm-account-transports';
import { cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

const SEAT_REF = 'seat-delivery-01';
const TOKEN = 'delivery-token-seat-01';

const projection = (ownerUserId: string, overrides = {}) => ({
  cli: 'claude' as const,
  ownerUserId,
  expectedOwnerScope: 'owner-seat-01',
  externalAccountId: 'claude-delivery-01',
  accountLabel: 'claude delivery',
  accessToken: 'sk-ant-delivery-01',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  seatPolicy: {
    seatRef: SEAT_REF,
    ownerScope: 'owner-seat-01',
    epoch: 1,
    generation: 1,
    operationId: 'op-delivery-01',
  },
  billingClear: true,
  ...overrides,
});

const post = (app: ReturnType<typeof createSeatDeliveryRouter>, path: string, body: unknown, token = TOKEN) =>
  app.request(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('llm seat delivery', () => {
  const saved = { ...process.env };
  let userId = '';

  beforeEach(async () => {
    userId = (await createAuthenticatedUser('admin_app')).id;
    process.env['SEAT_DELIVERY_TRUSTED_HOP'] = '1';
    process.env['SEAT_DELIVERY_SEATS_JSON'] = JSON.stringify({
      [SEAT_REF]: {
        ownerUserId: userId,
        externalAccountId: 'claude-delivery-01',
        ownerScope: 'owner-seat-01',
        billingReceipt: 'receipt-synth-01',
        token: TOKEN,
      },
    });
  });

  afterEach(async () => {
    process.env = { ...saved };
    await cleanupAuthData();
  });

  it('imports a projection, acknowledges it, and replays idempotently', async () => {
    const app = createSeatDeliveryRouter();
    const first = await post(app, '/import', { seatRef: SEAT_REF, ...projection(userId) });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ acknowledged: true, idempotent: false });

    const ack = await app.request(`/ack?seatRef=${SEAT_REF}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(ack.status).toBe(200);
    expect(await ack.json()).toMatchObject({ acknowledged: true });

    const replay = await post(app, '/import', { seatRef: SEAT_REF, ...projection(userId) });
    expect(await replay.json()).toMatchObject({ acknowledged: true, idempotent: true });
  });

  it('refuses forged headers, direct access, and stale generations', async () => {
    const app = createSeatDeliveryRouter();
    expect((await post(app, '/import', { seatRef: SEAT_REF, ...projection(userId) }, 'forged')).status).toBe(401);

    const delivered = await post(app, '/import', { seatRef: SEAT_REF, ...projection(userId) });
    expect(delivered.status).toBe(200);

    const stale = await post(app, '/import', {
      seatRef: SEAT_REF,
      ...projection(userId, {
        accessToken: 'sk-ant-stale',
        seatPolicy: { seatRef: SEAT_REF, ownerScope: 'owner-seat-01', epoch: 1, generation: 0, operationId: 'op-old' },
      }),
    });
    expect(stale.status).toBe(409);
  });

  it('derives identity from the registry and refuses disagreeing body values', async () => {
    const app = createSeatDeliveryRouter();
    const forgedOwner = await post(app, '/import', {
      seatRef: SEAT_REF,
      ...projection('user-other-01'),
    });
    expect(forgedOwner.status).toBe(409);

    const forgedScope = await post(app, '/import', {
      seatRef: SEAT_REF,
      ...projection(userId, {
        seatPolicy: { seatRef: SEAT_REF, ownerScope: 'owner-other-01', epoch: 1, generation: 1, operationId: 'op-x' },
      }),
    });
    expect(forgedScope.status).toBe(409);

    const deniedBilling = await post(app, '/import', {
      seatRef: SEAT_REF,
      ...projection(userId, { billingClear: false }),
    });
    expect(deniedBilling.status).toBe(409);
  });

  it('drains admission around maintenance and reopens after verification', async () => {
    const app = createSeatDeliveryRouter();
    expect((await post(app, '/import', { seatRef: SEAT_REF, ...projection(userId) })).status).toBe(200);

    const drain = await post(app, '/drain', { seatRef: SEAT_REF });
    expect(drain.status).toBe(200);
    const whileDrained = await acquireClaudeCodeAccountTransport({
      userId,
      modelId: 'claude-sonnet-4-6',
      requestId: 'seat-delivery-drained',
    });
    expect(whileDrained).toBeNull();

    const reopen = await post(app, '/reopen', { seatRef: SEAT_REF });
    expect(reopen.status).toBe(200);
    const served = await acquireClaudeCodeAccountTransport({
      userId,
      modelId: 'claude-sonnet-4-6',
      requestId: 'seat-delivery-reopened',
    });
    expect(served?.accessToken).toBe('sk-ant-delivery-01');
    await served?.recordOutcome({ status: 'success' });
  });
});
