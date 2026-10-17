import { describe, expect, it, vi } from 'vitest';
import { exactInput, KeyboardFlow } from '$lib/session-content/proof';
import { browserStepUp } from '$lib/session-content/api';
vi.mock('@sentropic/cowork-bridge/core', () => ({ getApiAuthToken: () => null }));

const context = {
  bindingId: 'binding', bindingVersion: 1, sourceGeneration: 'source', incarnation: 'incarnation',
  projectRevision: 1, ownerId: 'owner', workspaceId: 'workspace', controllerEpoch: 1,
  sourceAvailable: true, liveAuthorized: true, authenticationState: 'step_up_required' as const, confirmationAvailable: true,
};
const challenge = () => ({ native: { protocol: 'h2a.session-content' as const, protocolVersion: 2 as const,
  kind: 'confirmation-challenge' as const, challengeDigest: 'a'.repeat(64), challenge: {
    id: crypto.randomUUID(), owner: { issuer: 'https://idp.example', subject: 'owner' },
    project: { tenantId: 'tenant', workspaceId: 'workspace', workspaceIncarnation: 'wi', projectId: 'project' },
    source: { workstationId: 'ws', bindingId: 'binding', bindingVersion: 1, sourceId: 'source',
      sourceGeneration: 'source', sourceBootId: 'boot' }, clientId: 'confirmation',
    purpose: 'remote-action' as const, target: { kind: 'action' as const, scopeDigest: 'b'.repeat(64),
      operation: 'input', operationId: 'op', connectionId: 'connection', controllerEpoch: 1,
      byteLength: 1, payloadHash: 'c'.repeat(64) },
    random: 'r'.repeat(43), issuedAt: Date.now(), expiresAt: Date.now() + 60000,
  } }, authorization: { url: 'https://idp.example/authorize', state: 's'.repeat(43) } });
const confirmation = (proof: ReturnType<typeof challenge>) => ({ challengeId: proof.native.challenge.id,
  challengeDigest: proof.native.challengeDigest, idToken: 'synthetic-idp-proof' });
const confirmLease = async (flow: KeyboardFlow) => { await flow.acquire(); await flow.send(); };
const ports = () => ({
  prepareLease: vi.fn(async () => challenge()),
  acquire: vi.fn(async () => ({ controllerEpoch: 1, expiresAt: Date.now() + 60000 })),
  prepare: vi.fn(async () => challenge()),
  prove: vi.fn(async (proof: ReturnType<typeof challenge>) => confirmation(proof)),
  submit: vi.fn(async () => ({ status: 'submitted' as const })),
  query: vi.fn(async () => ({ status: 'submitted' as const })),
  newKey: vi.fn(() => crypto.randomUUID()),
});

describe('bounded browser-confirmed keyboard', () => {
  it('should correlate IdP return to the live originating page without submitting', async () => {
    const proof = challenge();
    const url = new URL(proof.authorization.url);
    for (const [key, value] of Object.entries({ client_id: 'confirmation', response_type: 'code',
      scope: 'openid', prompt: 'login', state: proof.authorization.state, code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256', redirect_uri: `${window.location.origin}/confirmation-return`,
      nonce: btoa(String.fromCharCode(...new Uint8Array(32).fill(170))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') })) {
      url.searchParams.set(key, value);
    }
    proof.authorization.url = url.toString();
    const popup = { close: vi.fn(), closed: false };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const returned = browserStepUp(proof, new AbortController().signal);
    const callback = (origin: string, source: unknown, state = proof.authorization.state) =>
      window.dispatchEvent(new MessageEvent('message', { origin, source: source as Window,
        data: { type: 'session-content-confirmation', state, proof: confirmation(proof) } }));
    callback('https://wrong.example', popup); callback(window.location.origin, window);
    expect(popup.close).not.toHaveBeenCalled();
    callback(window.location.origin, popup);
    await expect(returned).resolves.toEqual(confirmation(proof));
    expect(popup.close).toHaveBeenCalledOnce();
    const abort = new AbortController();
    const cancelled = browserStepUp(proof, abort.signal); abort.abort();
    await expect(cancelled).rejects.toThrow('confirmation_refused');
    for (const mutation of ['prompt', 'nonce', 'state', 'code_challenge_method']) {
      const invalid = structuredClone(proof); const changed = new URL(invalid.authorization.url);
      changed.searchParams.delete(mutation); invalid.authorization.url = changed.toString();
      await expect(browserStepUp(invalid, new AbortController().signal)).rejects.toThrow('confirmation_refused');
    }
    expect(open).toHaveBeenCalledTimes(2); open.mockRestore();
  });

  it.each(['authentication_required', 'step_up_required', 'confirmation_refused', 'source_unavailable'])(
    'should expose %s after a missing, insufficient or failed IdP return with zero effects', async (state) => {
      const api = ports(); api.prove.mockRejectedValueOnce(new Error(state));
      const flow = new KeyboardFlow(context, api);
      await expect(flow.acquire()).rejects.toThrow(state);
      expect(flow.status).toBe(state);
      await flow.send();
      expect(api.acquire).not.toHaveBeenCalled(); expect(api.submit).not.toHaveBeenCalled();
    });

  it('should refuse a callback correlated to another native challenge', async () => {
    const api = ports(); api.prove.mockResolvedValueOnce(confirmation(challenge()));
    const flow = new KeyboardFlow(context, api);
    await expect(flow.acquire()).rejects.toThrow('confirmation_refused');
    await flow.send();
    expect(api.acquire).not.toHaveBeenCalled(); expect(api.submit).not.toHaveBeenCalled();
  });

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

  it.each(['sourceAvailable', 'liveAuthorized', 'confirmationAvailable'] as const)(
    'should make zero control calls when %s is unavailable', async (field) => {
      const api = ports();
      const flow = new KeyboardFlow({ ...context, [field]: false }, api);
      flow.edit('echo ok', false);
      await flow.acquire(); await flow.prepare(); await flow.send();
      for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
    },
  );

  it('should acquire separately and invalidate a prepared action when edited or cancelled', async () => {
    const api = ports(); const flow = new KeyboardFlow(context, api);
    await confirmLease(flow); flow.edit('first', false); await flow.prepare();
    expect(api.prove).toHaveBeenCalledTimes(2);
    flow.edit('changed', true); await flow.send();
    expect(api.submit).not.toHaveBeenCalled();
    await flow.prepare(); flow.cancel(); await flow.send();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('should discard an expired preparation and never dispatch a proof completed after editing', async () => {
    const api = ports(); const flow = new KeyboardFlow(context, api);
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await confirmLease(flow); flow.edit('expire', false);
    api.prepare.mockResolvedValueOnce((() => { const proof = challenge(); proof.native.challenge.expiresAt = now + 1000; return proof; })());
    await flow.prepare(); clock.mockReturnValue(now + 2000); await flow.send();
    expect(flow.text).toBe(''); expect(api.submit).not.toHaveBeenCalled();
    flow.edit('first', false); flow.cancel(); flow.edit('first', false);
    let resolve!: (value: ReturnType<typeof confirmation>) => void;
    api.prove.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = flow.prepare(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    flow.edit('changed', false); resolve(confirmation(challenge())); await pending;
    expect(api.submit).not.toHaveBeenCalled(); expect(flow.text).toBe('changed');
  });

  it('should submit once, discard transient bytes and reconcile a lost response without replay', async () => {
    const api = ports(); api.submit.mockRejectedValueOnce({ status: 429 });
    const flow = new KeyboardFlow(context, api);
    await confirmLease(flow); flow.edit('run once', true); await flow.prepare();
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
    await confirmLease(flow); flow.edit('first', false); await flow.prepare();
    flow.setContext({ ...context, projectRevision: 2 }); await flow.send();
    expect(api.submit).not.toHaveBeenCalled();
    await confirmLease(flow); flow.edit('second', false);
    api.prove.mockRejectedValueOnce(new DOMException('Cancelled', 'NotAllowedError'));
    await expect(flow.prepare()).rejects.toThrow();
    expect(flow.status).toBe('confirmation_refused');
    expect(api.submit).not.toHaveBeenCalled();
    flow.dispose(); expect(flow.text).toBe('');
    await confirmLease(flow); expect(api.prepareLease).toHaveBeenCalledTimes(2);
  });
});
