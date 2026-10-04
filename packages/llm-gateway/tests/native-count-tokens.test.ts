import { describe, expect, it } from 'vitest';
import { GatewayError, SAFEGUARDS_NOT_SUPPORTED_MESSAGE } from '../src/index.js';
import { countHarness, sendCount } from './fixtures/native-count.js';

describe('native count authentication, switch and model gates', () => {
  it.each([false, undefined])('requires exact enabled=true (%s), after caller authentication', async enabled => {
    const h = countHarness({ nativeMessagesEnabled: enabled });
    for (const safeguards of [false, true]) {
      const response = await sendCount(h, { model: 'unknown', ...(safeguards ? { safeguards: null } : {}) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error',
        message: safeguards ? SAFEGUARDS_NOT_SUPPORTED_MESSAGE
          : 'Token counting is not supported by this gateway route while native Messages is disabled.' } });
      expect(response.headers.has('x-sentropic-relay')).toBe(false);
    }
    expect(h.auth).toHaveBeenCalledTimes(2); expect(h.prepare).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('rejects caller/partition before validation or the disabled switch', async () => {
    const denied = countHarness({ nativeMessagesEnabled: false });
    denied.options.config.callerAuth.verify = async () => ({ ok: false });
    const response = await sendCount(denied, {});
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ type: 'error',
      error: { type: 'authentication_error', message: 'authentication failed' } });
    expect(denied.prepare).not.toHaveBeenCalled();
    const partition = countHarness();
    Object.assign(partition.options.config, { mode: 'cross-user-pool', crossUserPoolEnabled: false });
    expect((await sendCount(partition, {})).status).toBe(400);
    expect(partition.auth).toHaveBeenCalledTimes(1); expect(partition.prepare).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { model: '' }, { model: 2 }])('validates only object/nonempty model (%j)', async body => {
    const h = countHarness(); const response = await sendCount(h, body);
    expect(response.status).toBe(400); expect(h.auth).toHaveBeenCalledTimes(1);
    expect(h.prepare).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });
  it.each(['missing_port', 'missing_capability', 'wrong_model', 'wrong_provider', 'denied_model', 'version'])
    ('refuses known native-denied requests without dispatch (%s)', async reason => {
      const h = countHarness(reason === 'missing_port' ? { nativeCountTokens: undefined } : {});
      if (reason === 'missing_capability') h.prepare.mockResolvedValue(undefined);
      if (reason === 'wrong_model') h.prepare.mockResolvedValue({ ...h.capability, modelId: 'other' });
      if (reason === 'wrong_provider') h.prepare.mockResolvedValue({ ...h.capability, providerId: 'openai' });
      if (reason === 'denied_model') h.port.modelIds.length = 0;
      for (const safeguards of [false, true]) {
        const response = await sendCount(h, { model: h.model, ...(safeguards ? { safeguards: {} } : {}) },
          reason === 'version' ? { 'anthropic-version': 'unsupported' } : {});
        expect(response.status).toBe(400); expect(await response.json()).toEqual({ type: 'error',
          error: { type: 'invalid_request_error', message: safeguards ? SAFEGUARDS_NOT_SUPPORTED_MESSAGE
            : 'Token counting is not supported by this gateway route for this request.' } });
      }
      expect(h.execute).not.toHaveBeenCalled();
    });
  it('keeps genuinely unknown models at the existing model-only 404', async () => {
    const h = countHarness(); h.prepare.mockRejectedValue(new GatewayError('unknown-model', 'secret catalog'));
    const response = await sendCount(h, { model: 'absent' });
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ type: 'error',
      error: { type: 'not_found_error', message: 'Unknown model: "absent"' } });
    expect(h.execute).not.toHaveBeenCalled();
  });
});
