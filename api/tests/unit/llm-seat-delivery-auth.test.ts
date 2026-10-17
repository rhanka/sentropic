import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { requireSeatDeliveryAuth } from '../../src/middleware/llm-seat-delivery-auth';

const buildApp = () => {
  const app = new Hono();
  app.use('/*', requireSeatDeliveryAuth);
  app.post('/probe', (c) => c.json({ ok: true, seatRef: c.get('seatRef') }));
  app.get('/probe', (c) => c.json({ ok: true, seatRef: c.get('seatRef') }));
  return app;
};

describe('llm seat delivery auth', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('refuses direct access without the trusted hop', async () => {
    process.env['SEAT_DELIVERY_TRUSTED_HOP'] = '0';
    process.env['SEAT_DELIVERY_TOKEN'] = 'delivery-token';
    process.env['SEAT_DELIVERY_ALLOWLIST'] = 'seat-synth-01';
    const response = await buildApp().request('/probe', {
      method: 'POST',
      headers: { authorization: 'Bearer delivery-token', 'content-type': 'application/json' },
      body: JSON.stringify({ seatRef: 'seat-synth-01' }),
    });
    expect(response.status).toBe(503);
  });

  it('refuses forged bearer tokens on the trusted hop', async () => {
    process.env['SEAT_DELIVERY_TRUSTED_HOP'] = '1';
    process.env['SEAT_DELIVERY_TOKEN'] = 'delivery-token';
    process.env['SEAT_DELIVERY_ALLOWLIST'] = 'seat-synth-01';
    const response = await buildApp().request('/probe', {
      method: 'POST',
      headers: { authorization: 'Bearer forged-token', 'content-type': 'application/json' },
      body: JSON.stringify({ seatRef: 'seat-synth-01' }),
    });
    expect(response.status).toBe(401);
  });

  it('refuses seats outside the fixed allowlist', async () => {
    process.env['SEAT_DELIVERY_TRUSTED_HOP'] = '1';
    process.env['SEAT_DELIVERY_TOKEN'] = 'delivery-token';
    process.env['SEAT_DELIVERY_ALLOWLIST'] = 'seat-synth-01';
    const response = await buildApp().request('/probe', {
      method: 'POST',
      headers: { authorization: 'Bearer delivery-token', 'content-type': 'application/json' },
      body: JSON.stringify({ seatRef: 'seat-other-01' }),
    });
    expect(response.status).toBe(403);
  });

  it('admits an allowlisted seat on the trusted hop', async () => {
    process.env['SEAT_DELIVERY_TRUSTED_HOP'] = '1';
    process.env['SEAT_DELIVERY_TOKEN'] = 'delivery-token';
    process.env['SEAT_DELIVERY_ALLOWLIST'] = 'seat-synth-01';
    const response = await buildApp().request('/probe?seatRef=seat-synth-01', {
      headers: { authorization: 'Bearer delivery-token' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, seatRef: 'seat-synth-01' });
  });
});
