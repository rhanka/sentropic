import { describe, expect, it, vi } from 'vitest';
import { browserAssertion, canUseCredential, exactInput, KeyboardFlow } from '$lib/session-content/proof';
import { startAuthentication } from '@simplewebauthn/browser';
vi.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(async () => ({ id: 'key' })), WebAuthnAbortService: { cancelCeremony: vi.fn() } }));

const context = {
  bindingId: 'binding', bindingVersion: 1, sourceGeneration: 'source', incarnation: 'incarnation',
  projectRevision: 1, ownerId: 'owner', workspaceId: 'workspace', controllerEpoch: 1,
  sourceAvailable: true, liveAuthorized: true, credentialUsable: true,
};
const challenge = () => ({ challengeId: 'nonce', expiresAt: Date.now() + 60000,
  options: { challenge: 'bm9uY2U', rpId: 'localhost', userVerification: 'required' as const,
    allowCredentials: [{ id: 'key', type: 'public-key' as const }] } });
const ports = () => ({
  prepareLease: vi.fn(async () => challenge()),
  acquire: vi.fn(async () => ({ controllerEpoch: 1, expiresAt: Date.now() + 60000 })),
  prepare: vi.fn(async () => challenge()),
  prove: vi.fn(async () => ({ id: 'key' })),
  submit: vi.fn(async () => ({ status: 'submitted' as const })),
  query: vi.fn(async () => ({ status: 'submitted' as const })),
  newKey: vi.fn(() => crypto.randomUUID()),
});

describe('bounded browser-confirmed keyboard', () => {
  it('should return from each fresh IdP ceremony without automatically acquiring or sending', async () => {
    const api = ports(); const flow = new KeyboardFlow(context, api);
    await flow.acquire();
    expect(api.acquire).not.toHaveBeenCalled();
    expect(api.prove).toHaveBeenCalledTimes(1);
    await flow.send();
    expect(api.acquire).toHaveBeenCalledTimes(1);
    flow.edit('first', false); await flow.prepare();
    expect(api.prove).toHaveBeenCalledTimes(2);
    expect(api.submit).not.toHaveBeenCalled();
    await flow.send();
    flow.edit('second', true); await flow.prepare();
    expect(api.prove).toHaveBeenCalledTimes(3);
    expect(api.submit).toHaveBeenCalledTimes(1);
    await flow.send(); await flow.send();
    expect(api.submit).toHaveBeenCalledTimes(2);
  });

  it('should preview exact UTF-8 bytes and escaped controls without adding a newline', () => {
    expect(exactInput('é\u001b', false)).toMatchObject({ text: 'é\u001b', byteLength: 3, preview: '"é\\u001b"' });
    expect(exactInput('echo ok', true).text).toBe('echo ok\n');
    expect(() => exactInput('é'.repeat(2049), false)).toThrow();
    expect(() => exactInput('\ud800', false)).toThrow();
  });

  it.each(['sourceAvailable', 'liveAuthorized', 'credentialUsable'] as const)(
    'should make zero control calls when %s is unavailable', async (field) => {
      const api = ports();
      const flow = new KeyboardFlow({ ...context, [field]: false }, api);
      flow.edit('echo ok', false);
      await flow.acquire(); await flow.prepare(); await flow.send();
      for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
    },
  );

  it('should require a usable independently enrolled away credential and supported browser', () => {
    const key = { id: 'key', rpId: 'localhost', origins: ['http://localhost'],
      awayUsable: true, locallyEnrolled: true, revoked: false };
    expect(canUseCredential([key], true, 'http://localhost')).toBe(true);
    for (const keys of [[], [{ ...key, awayUsable: false }], [{ ...key, revoked: true }],
      [{ ...key, locallyEnrolled: false }], [{ ...key, origins: ['https://elsewhere'] }]]) {
      expect(canUseCredential(keys, true, 'http://localhost')).toBe(false);
    }
    expect(canUseCredential([key], false, 'http://localhost')).toBe(false);
  });

  it('should acquire separately and invalidate a prepared action when edited or cancelled', async () => {
    const api = ports(); const flow = new KeyboardFlow(context, api);
    await flow.acquire(); flow.edit('first', false); await flow.prepare();
    expect(api.prove).toHaveBeenCalledTimes(1);
    flow.edit('changed', true); await flow.send();
    expect(api.submit).not.toHaveBeenCalled();
    await flow.prepare(); flow.cancel(); await flow.send();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('should request required UV only for the exact enrolled RP, origin and key', async () => {
    const key = { id: 'key', rpId: 'localhost', origins: [window.location.origin],
      locallyEnrolled: true, awayUsable: true, revoked: false };
    await browserAssertion(challenge(), [key], new AbortController().signal);
    expect(startAuthentication).toHaveBeenCalledWith(expect.objectContaining({
      optionsJSON: expect.objectContaining({ rpId: 'localhost', userVerification: 'required' }),
    }));
    vi.mocked(startAuthentication).mockClear();
    await expect(browserAssertion({ ...challenge(), options: { ...challenge().options, rpId: 'elsewhere' } },
      [key], new AbortController().signal)).rejects.toThrow('invalid_source_challenge');
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it('should discard an expired preparation and never dispatch a proof completed after editing', async () => {
    const api = ports(); const flow = new KeyboardFlow(context, api);
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await flow.acquire(); flow.edit('expire', false);
    api.prepare.mockResolvedValueOnce({ ...challenge(), expiresAt: now + 1000 });
    await flow.prepare(); clock.mockReturnValue(now + 2000); await flow.send();
    expect(flow.text).toBe(''); expect(api.submit).not.toHaveBeenCalled();
    flow.edit('first', false); await flow.prepare();
    let resolve!: (value: { id: string }) => void;
    api.prove.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = flow.send(); flow.edit('changed', false); resolve({ id: 'key' }); await pending;
    expect(api.submit).not.toHaveBeenCalled(); expect(flow.text).toBe('changed');
  });

  it('should submit once, discard transient bytes and reconcile a lost response without replay', async () => {
    const api = ports(); api.submit.mockRejectedValueOnce({ status: 429 });
    const flow = new KeyboardFlow(context, api);
    await flow.acquire(); flow.edit('run once', true); await flow.prepare();
    await flow.send();
    const key = flow.lastKey;
    expect(flow.status).toBe('outcome_unknown'); expect(flow.text).toBe('');
    await flow.send(); await flow.reconcile();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.query).toHaveBeenCalledWith(key);
    expect(flow.status).toBe('submitted');
  });

  it('should fence stale scope, expiry, logout and a cancelled authentication before any input', async () => {
    const api = ports(); const flow = new KeyboardFlow(context, api);
    await flow.acquire(); flow.edit('first', false); await flow.prepare();
    flow.setContext({ ...context, projectRevision: 2 }); await flow.send();
    expect(api.submit).not.toHaveBeenCalled();
    await flow.acquire(); flow.edit('second', false); await flow.prepare();
    api.prove.mockRejectedValueOnce(new DOMException('Cancelled', 'NotAllowedError'));
    await expect(flow.send()).rejects.toThrow();
    expect(flow.status).toBe('refused');
    expect(api.submit).not.toHaveBeenCalled();
    flow.dispose(); expect(flow.text).toBe('');
    await flow.acquire(); expect(api.prepareLease).toHaveBeenCalledTimes(2);
  });
});
