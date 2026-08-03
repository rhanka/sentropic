import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

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
        (runner as unknown as { active: Set<string> }).active.add('lease-stop');
        await runner.stop();
        expect(calls).toEqual([{
            url: 'https://api.example.test/api/v1/chrome-extension/cowork-devices/leases/lease-stop/revoke',
            body: JSON.stringify({ reason: 'local_stop' }),
        }]);
    });
});
