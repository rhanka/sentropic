import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeCustodyToken, encodeCustodyToken } from '../src/index.js';
import {
  FailingConsumeCustodyState,
  createCustodyRouterFixture,
  custodyCommand,
} from './custody-router-fixture.js';

const post = (fixture: ReturnType<typeof createCustodyRouterFixture>, body: unknown) =>
  fixture.app.request('/control/drive', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

describe('custody-controlled session router', () => {
  it('should transport a distinct token and authorize then actuate inline', async () => {
    const fixture = createCustodyRouterFixture();
    const token = await fixture.token('invocation-1');
    fixture.events.length = 0;

    const response = await post(fixture, custodyCommand('invocation-1', token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'acted', effectRef: 'effect-1' });
    const consumed = fixture.events.indexOf('consume:end');
    expect(fixture.events.slice(consumed, consumed + 3)).toEqual(['consume:end', 'available', 'actuate']);
    expect(fixture.events.indexOf('resolve')).toBeLessThan(fixture.events.indexOf('consume:start'));
    expect(fixture.events.indexOf('store:accepted')).toBeGreaterThan(fixture.events.indexOf('actuate'));
  });

  it('should actuate only once for sibling tokens bound to one invocation', async () => {
    const fixture = createCustodyRouterFixture();
    const first = await fixture.token('invocation-1');
    const second = await fixture.token('invocation-1');

    expect((await post(fixture, custodyCommand('invocation-1', first))).status).toBe(200);
    const replay = await post(fixture, custodyCommand('invocation-1', second));

    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toEqual({ error: 'custody_mismatch' });
    expect(fixture.pty.actuate).toHaveBeenCalledOnce();
  });

  it('should require a new invocation ID before retrying actuation', async () => {
    const fixture = createCustodyRouterFixture();
    const first = await fixture.token('invocation-1');
    const retry = await fixture.token('invocation-2');

    expect((await post(fixture, custodyCommand('invocation-1', first))).status).toBe(200);
    expect((await post(fixture, custodyCommand('invocation-2', retry))).status).toBe(200);
    expect(fixture.pty.actuate).toHaveBeenCalledTimes(2);
  });

  it('should reject legacy custody without source provenance before registration reload', async () => {
    const fixture = createCustodyRouterFixture({ legacyCustody: true });
    const response = await post(fixture, custodyCommand('invocation-legacy'));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'custody_required' });
    expect(fixture.gateFind).not.toHaveBeenCalled();
    expect(fixture.pty.actuate).not.toHaveBeenCalled();
  });

  it('should map an unavailable atomic consume store to custody_mismatch', async () => {
    const state = new FailingConsumeCustodyState();
    const fixture = createCustodyRouterFixture({ state });
    const token = await fixture.token('invocation-1');
    state.failConsume = true;

    const response = await post(fixture, custodyCommand('invocation-1', token));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'custody_mismatch' });
    expect(fixture.pty.actuate).not.toHaveBeenCalled();
  });

  it.each([
    'garbage',
    Buffer.from('not a custody token', 'utf8').toString('base64url'),
  ])('should map a malformed custody token to custody_mismatch', async (custodyToken) => {
    const fixture = createCustodyRouterFixture();
    const response = await post(fixture, custodyCommand('invocation-1', custodyToken));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'custody_mismatch' });
    expect(fixture.pty.actuate).not.toHaveBeenCalled();
  });

  it('should map a tampered custody signature to custody_mismatch', async () => {
    const fixture = createCustodyRouterFixture();
    const token = decodeCustodyToken(await fixture.token('invocation-1'));
    const signature = Buffer.from(token.evidence.signatureBase64Url, 'base64url');
    signature[0] ^= 0x01;
    const custodyToken = encodeCustodyToken({
      ...token,
      evidence: { ...token.evidence, signatureBase64Url: signature.toString('base64url') },
    });

    const response = await post(fixture, custodyCommand('invocation-1', custodyToken));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'custody_mismatch' });
    expect(fixture.pty.actuate).not.toHaveBeenCalled();
  });

  it('should reject deferred actuation after spending the inline invocation', async () => {
    const fixture = createCustodyRouterFixture({ outcome: 'deferred' });
    const token = await fixture.token('invocation-1');
    const response = await post(fixture, custodyCommand('invocation-1', token));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'actuation_failed', status: 'failed', effectRef: 'effect-1',
    });
    expect(fixture.store.updateCommand).toHaveBeenLastCalledWith('invocation-1', {
      status: 'failed', refusalReason: 'actuation_failed',
    });
  });
});
