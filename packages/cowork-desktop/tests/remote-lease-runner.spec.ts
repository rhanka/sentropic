import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createMockCapabilityProvider } from '../src/capability/index.js';
import { ConsentManager, createMemoryConsentStore } from '../src/consent/index.js';
import { RemoteLeaseRunner } from '../src/remote/index.js';

const canonical = (fields: Record<string, string>) => JSON.stringify({
    leaseId: fields.leaseId, capability: fields.capability, targetDeviceId: fields.targetDeviceId,
    nonce: fields.nonce, expiry: fields.expiry,
});

describe('RemoteLeaseRunner', () => {
    it('verifies the server envelope before ack, asks consent, then posts only a bounded result', async () => {
        const server = generateKeyPairSync('ed25519');
        const device = generateKeyPairSync('ed25519');
        const deviceId = randomUUID();
        const expiry = new Date(Date.now() + 20_000).toISOString();
        const fields = { leaseId: 'lease-1', capability: 'input_action', targetDeviceId: deviceId, nonce: 'nonce-1', expiry };
        const mac = sign(null, Buffer.from(canonical(fields)), server.privateKey).toString('base64url');
        const publicJwk = { ...server.publicKey.export({ format: 'jwk' }), kid: 'oauth-key' };
        const calls: Array<{ url: string; body?: string }> = [];
        const fetch = async (url: string, init?: RequestInit) => {
            calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
            if (url.endsWith('/.well-known/jwks.json')) return new Response(JSON.stringify({ keys: [publicJwk] }));
            return new Response('{}', { status: 200 });
        };
        const provider = createMockCapabilityProvider();
        const runner = new RemoteLeaseRunner({
            fetch, apiBaseUrl: 'https://api.example.test/api/v1', getAccessToken: async () => 'bearer',
            deviceIdentity: { deviceId, publicKey: '', sign: async (payload) => sign(null, Buffer.from(payload), device.privateKey).toString('base64url') },
            consent: new ConsentManager({ store: createMemoryConsentStore(), prompt: async () => 'allow_once' }), context: { provider },
        });

        await runner.handleLease({ ...fields, expiresAt: expiry, scope: { capability: fields.capability, serverEnvelope: { kid: 'oauth-key', mac }, action: { action: 'click', x: 1, y: 2 } } });
        expect(provider.calls).toEqual([{ kind: 'mouseClick', x: 1, y: 2, button: 'left' }]);
        expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
            'https://api.example.test/.well-known/jwks.json',
            'https://api.example.test/api/v1/chrome-extension/cowork-devices/leases/lease-1/ack',
            'https://api.example.test/api/v1/chrome-extension/cowork-devices/leases/lease-1/result',
        ]));
        expect(calls.find((call) => call.url.endsWith('/result'))?.body).toContain('FAIT');
    });

    it('does not acknowledge or execute a forged envelope', async () => {
        const provider = createMockCapabilityProvider();
        const runner = new RemoteLeaseRunner({
            fetch: async () => new Response(JSON.stringify({ keys: [] })), apiBaseUrl: 'https://api.example.test/api/v1', getAccessToken: async () => 'bearer',
            deviceIdentity: { deviceId: randomUUID(), publicKey: '', sign: async () => 'signature' },
            consent: new ConsentManager({ store: createMemoryConsentStore(), prompt: async () => 'allow_once' }), context: { provider },
        });
        await runner.handleLease({ leaseId: 'forged', nonce: 'n', expiresAt: new Date(Date.now() + 10_000).toISOString(), scope: { capability: 'input_action', serverEnvelope: { kid: 'missing', mac: 'forged' }, action: { action: 'click', x: 1, y: 2 } } });
        expect(provider.calls).toEqual([]);
    });

    it('revoke active leases when the local host stops', async () => {
        const calls: Array<{ url: string; body?: string }> = [];
        const runner = new RemoteLeaseRunner({
            fetch: async (url: string, init?: RequestInit) => {
                calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
                return new Response('{}');
            },
            apiBaseUrl: 'https://api.example.test/api/v1', getAccessToken: async () => 'bearer',
            deviceIdentity: { deviceId: randomUUID(), publicKey: '', sign: async () => 'signature' },
            consent: new ConsentManager({ store: createMemoryConsentStore() }), context: { provider: createMockCapabilityProvider() },
        });
        (runner as unknown as { active: Map<string, { cancelled: boolean }> }).active.set('lease-stop', { cancelled: false });
        await runner.stop();
        expect(calls).toEqual([{
            url: 'https://api.example.test/api/v1/chrome-extension/cowork-devices/leases/lease-stop/revoke',
            body: JSON.stringify({ reason: 'local_stop' }),
        }]);
    });

    it.each([
        { name: 'lease expiry', ackStatus: 200, advanceClock: true },
        { name: 'server timeout revocation', ackStatus: 409, advanceClock: false },
        { name: 'device deletion', ackStatus: 404, advanceClock: false },
        { name: 'account deletion', ackStatus: 403, advanceClock: false },
    ])('never calls the provider after $name while consent is held', async ({ ackStatus, advanceClock }) => {
        const now = 1_000_000;
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
        const server = generateKeyPairSync('ed25519');
        const device = generateKeyPairSync('ed25519');
        const deviceId = randomUUID();
        const expiry = new Date(now + 5_000).toISOString();
        const fields = { leaseId: `lease-${ackStatus}`, capability: 'input_action', targetDeviceId: deviceId, nonce: 'nonce', expiry };
        const mac = sign(null, Buffer.from(canonical(fields)), server.privateKey).toString('base64url');
        let allow!: (decision: 'allow_once') => void;
        let promptReady!: () => void;
        const prompted = new Promise<void>((resolve) => { promptReady = resolve; });
        const provider = createMockCapabilityProvider();
        const calls: string[] = [];
        const runner = new RemoteLeaseRunner({
            fetch: async (url: string) => {
                calls.push(url);
                if (url.endsWith('/.well-known/jwks.json')) {
                    return new Response(JSON.stringify({ keys: [{ ...server.publicKey.export({ format: 'jwk' }), kid: 'oauth-key' }] }));
                }
                if (url.endsWith('/ack')) return new Response('{}', { status: ackStatus });
                return new Response('{}');
            },
            apiBaseUrl: 'https://api.example.test/api/v1', getAccessToken: async () => 'bearer',
            deviceIdentity: { deviceId, publicKey: '', sign: async (payload) => sign(null, Buffer.from(payload), device.privateKey).toString('base64url') },
            consent: new ConsentManager({ store: createMemoryConsentStore(), prompt: async () => new Promise<'allow_once'>((grant) => { allow = grant; promptReady(); }) }), context: { provider },
        });
        try {
            const handling = runner.handleLease({ ...fields, expiresAt: expiry, scope: { capability: fields.capability, serverEnvelope: { kid: 'oauth-key', mac }, action: { action: 'click', x: 1, y: 2 } } });
            await prompted;
            expect(calls.filter((url) => url.endsWith('/ack'))).toHaveLength(0);
            if (advanceClock) clock.mockReturnValue(now + 6_000);
            allow('allow_once');
            await handling;
            expect(provider.calls).toEqual([]);
            expect(calls.filter((url) => url.endsWith('/ack'))).toHaveLength(advanceClock ? 0 : 1);
            expect(calls.some((url) => url.endsWith('/result'))).toBe(false);
        } finally {
            clock.mockRestore();
        }
    });

    it('marks a held-consent lease cancelled synchronously on Stop before any revoke I/O', async () => {
        const server = generateKeyPairSync('ed25519');
        const device = generateKeyPairSync('ed25519');
        const deviceId = randomUUID();
        const expiry = new Date(Date.now() + 20_000).toISOString();
        const fields = { leaseId: 'lease-stop-race', capability: 'input_action', targetDeviceId: deviceId, nonce: 'nonce', expiry };
        const mac = sign(null, Buffer.from(canonical(fields)), server.privateKey).toString('base64url');
        let allow!: (decision: 'allow_once') => void;
        let promptReady!: () => void;
        const promptReadyPromise = new Promise<void>((resolve) => { promptReady = resolve; });
        const provider = createMockCapabilityProvider();
        const runner = new RemoteLeaseRunner({
            fetch: async (url: string) => {
                if (url.endsWith('/.well-known/jwks.json')) {
                    return new Response(JSON.stringify({ keys: [{ ...server.publicKey.export({ format: 'jwk' }), kid: 'oauth-key' }] }));
                }
                return new Response('{}');
            },
            apiBaseUrl: 'https://api.example.test/api/v1', getAccessToken: async () => 'bearer',
            deviceIdentity: { deviceId, publicKey: '', sign: async (payload) => sign(null, Buffer.from(payload), device.privateKey).toString('base64url') },
            consent: new ConsentManager({ store: createMemoryConsentStore(), prompt: async () => new Promise<'allow_once'>((grant) => { allow = grant; promptReady(); }) }), context: { provider },
        });
        const handling = runner.handleLease({ ...fields, expiresAt: expiry, scope: { capability: fields.capability, serverEnvelope: { kid: 'oauth-key', mac }, action: { action: 'click', x: 1, y: 2 } } });
        await promptReadyPromise;
        const stopping = runner.stop();
        expect((runner as unknown as { active: Map<string, { cancelled: boolean }> }).active.get(fields.leaseId)?.cancelled).toBe(true);
        allow('allow_once');
        await handling;
        await stopping;
        expect(provider.calls).toEqual([]);
    });
});
