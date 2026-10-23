import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import {
  requireSeatDeliveryAuth,
  verifySeatDeliveryBearer,
  type SeatDeliveryRegistryEntry,
} from '../../src/middleware/llm-seat-delivery-auth';

const ENTRY: SeatDeliveryRegistryEntry = {
  ownerUserId: 'user-seat-01',
  externalAccountId: 'claude-delivery-01',
  ownerScope: 'owner-seat-01',
  billingReceipt: 'receipt-synth-01',
  token: 'delivery-token-seat-01',
};

const buildApp = () => {
  const app = new Hono();
  app.use('/*', requireSeatDeliveryAuth);
  app.post('/probe', (c) =>
    c.json({
      ok: true,
      seatRef: c.get('seatRef'),
      seat: c.get('seat'),
      trust: c.get('deliveryTrust'),
    }),
  );
  app.get('/probe', (c) =>
    c.json({
      ok: true,
      seatRef: c.get('seatRef'),
      seat: c.get('seat'),
      trust: c.get('deliveryTrust'),
    }),
  );
  return app;
};

const registryOnlyEnv = () => {
  delete process.env['SEAT_DELIVERY_TRUSTED_HOP'];
  process.env['SEAT_DELIVERY_SEATS_JSON'] = JSON.stringify({ 'seat-synth-01': ENTRY });
};

describe('llm seat delivery auth', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('compares bearers in constant time without leaking validity', () => {
    expect(verifySeatDeliveryBearer('delivery-token-seat-01', ENTRY.token)).toBe(true);
    expect(verifySeatDeliveryBearer('forged-token', ENTRY.token)).toBe(false);
    expect(verifySeatDeliveryBearer(null, ENTRY.token)).toBe(false);
    expect(verifySeatDeliveryBearer('delivery-token-seat-01', '')).toBe(false);
  });

  it('decides trust per request and never reads the process environment', async () => {
    delete process.env['SEAT_DELIVERY_TRUSTED_HOP'];
    process.env['SEAT_DELIVERY_SEATS_JSON'] = JSON.stringify({ 'seat-synth-01': ENTRY });
    const admitted = await buildApp().request('/probe', {
      method: 'POST',
      headers: { authorization: `Bearer ${ENTRY.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ seatRef: 'seat-synth-01' }),
    });
    expect(admitted.status).toBe(200);
    expect(await admitted.json()).toMatchObject({
      ok: true,
      seatRef: 'seat-synth-01',
      trust: { seatRef: 'seat-synth-01' },
    });

    process.env['SEAT_DELIVERY_TRUSTED_HOP'] = '0';
    const stillAdmitted = await buildApp().request('/probe?seatRef=seat-synth-01', {
      headers: { authorization: `Bearer ${ENTRY.token}` },
    });
    expect(stillAdmitted.status).toBe(200);
  });

  it('refuses a forged per-seat credential', async () => {
    registryOnlyEnv();
    const response = await buildApp().request('/probe', {
      method: 'POST',
      headers: { authorization: 'Bearer forged-token', 'content-type': 'application/json' },
      body: JSON.stringify({ seatRef: 'seat-synth-01' }),
    });
    expect(response.status).toBe(401);
  });

  it('refuses seats outside the server-side registry', async () => {
    registryOnlyEnv();
    const response = await buildApp().request('/probe', {
      method: 'POST',
      headers: { authorization: `Bearer ${ENTRY.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ seatRef: 'seat-other-01' }),
    });
    expect(response.status).toBe(403);
  });

  it('ignores forged caller-supplied identity headers', async () => {
    registryOnlyEnv();
    const response = await buildApp().request('/probe?seatRef=seat-synth-01', {
      headers: {
        authorization: `Bearer ${ENTRY.token}`,
        'x-forwarded-user': 'admin',
        'x-seat-delivery-cert-subject': 'CN=attacker',
        'x-seat-owner': 'owner-other-01',
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      seatRef: 'seat-synth-01',
      seat: { ownerUserId: 'user-seat-01', ownerScope: 'owner-seat-01' },
    });
  });

  it('admits a registered seat with a valid per-seat credential', async () => {
    registryOnlyEnv();
    const response = await buildApp().request('/probe?seatRef=seat-synth-01', {
      headers: { authorization: `Bearer ${ENTRY.token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, seatRef: 'seat-synth-01' });
  });
});
