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
  app.post('/probe', (c) => c.json({ ok: true, seatRef: c.get('seatRef') }));
  app.get('/probe', (c) => c.json({ ok: true, seatRef: c.get('seatRef') }));
  return app;
};

const registryEnv = () => {
  process.env['SEAT_DELIVERY_TRUSTED_HOP'] = '1';
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

  it('refuses direct access without the trusted hop', async () => {
    process.env['SEAT_DELIVERY_TRUSTED_HOP'] = '0';
    const response = await buildApp().request('/probe', {
      method: 'POST',
      headers: { authorization: `Bearer ${ENTRY.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ seatRef: 'seat-synth-01' }),
    });
    expect(response.status).toBe(503);
  });

  it('refuses forged bearer tokens on the trusted hop', async () => {
    registryEnv();
    const response = await buildApp().request('/probe', {
      method: 'POST',
      headers: { authorization: 'Bearer forged-token', 'content-type': 'application/json' },
      body: JSON.stringify({ seatRef: 'seat-synth-01' }),
    });
    expect(response.status).toBe(401);
  });

  it('refuses seats outside the server-side registry', async () => {
    registryEnv();
    const response = await buildApp().request('/probe', {
      method: 'POST',
      headers: { authorization: `Bearer ${ENTRY.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ seatRef: 'seat-other-01' }),
    });
    expect(response.status).toBe(403);
  });

  it('ignores forged caller-supplied identity headers', async () => {
    registryEnv();
    const response = await buildApp().request('/probe?seatRef=seat-synth-01', {
      headers: {
        authorization: `Bearer ${ENTRY.token}`,
        'x-forwarded-user': 'admin',
        'x-seat-delivery-cert-subject': 'CN=attacker',
        'x-seat-owner': 'owner-other-01',
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, seatRef: 'seat-synth-01' });
  });

  it('admits a registered seat on the trusted hop', async () => {
    registryEnv();
    const response = await buildApp().request('/probe?seatRef=seat-synth-01', {
      headers: { authorization: `Bearer ${ENTRY.token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, seatRef: 'seat-synth-01' });
  });
});
