import { createPublicKey, verify } from 'node:crypto';

import type { DeviceIdentitySigner, FetchLike } from '@sentropic/cowork-bridge/auth';
import type { ConsentManager } from '../consent/index.js';
import { runDesktopToolCall, type DesktopToolContext } from '../tools/index.js';

type Jwk = { kid?: string; kty: string; crv?: string; x?: string };
type Envelope = { kid: string; mac: string };
type DeliveredLease = {
    leaseId: string;
    nonce: string;
    scope: { capability?: unknown; serverEnvelope?: unknown; action?: unknown } | null;
    expiresAt: string;
};

const canonicalEnvelope = (fields: {
    leaseId: string; capability: string; targetDeviceId: string; nonce: string; expiry: string;
}) => JSON.stringify({
    leaseId: fields.leaseId, capability: fields.capability, targetDeviceId: fields.targetDeviceId,
    nonce: fields.nonce, expiry: fields.expiry,
});

const deliveryPayload = (deviceId: string, issuedAtMs: number) =>
    `cowork-device-delivery-v1:GET.${deviceId}.${issuedAtMs}`;

const isEnvelope = (value: unknown): value is Envelope => Boolean(
    value && typeof value === 'object' && typeof (value as Envelope).kid === 'string' && typeof (value as Envelope).mac === 'string',
);

const isCapability = (value: unknown): value is 'screen_capture' | 'input_action' =>
    value === 'screen_capture' || value === 'input_action';

export interface RemoteLeaseRunnerDeps {
    fetch: FetchLike;
    apiBaseUrl: string;
    getAccessToken: () => Promise<string | null>;
    deviceIdentity: DeviceIdentitySigner;
    consent: ConsentManager;
    context: DesktopToolContext;
}

/**
 * Cross-platform testable remote lease loop.  A native/WebView2 host only
 * supplies the foreground consent prompt; it never receives the bearer token.
 */
export class RemoteLeaseRunner {
    private readonly base: string;
    private readonly active = new Set<string>();

    constructor(private readonly deps: RemoteLeaseRunnerDeps) {
        this.base = deps.apiBaseUrl.replace(/\/$/, '');
    }

    async poll(): Promise<void> {
        const token = await this.deps.getAccessToken();
        if (!token) return;
        const headers = await this.deliveryHeaders(token);
        const response = await this.deps.fetch(
            `${this.base}/chrome-extension/cowork-devices/${encodeURIComponent(this.deps.deviceIdentity.deviceId)}/leases`,
            { headers },
        );
        if (!response.ok) return;
        const payload = await response.json() as { leases?: unknown };
        if (!Array.isArray(payload.leases)) return;
        for (const lease of payload.leases) await this.handleLease(lease);
    }

    async consumeSse(response: Awaited<ReturnType<FetchLike>>): Promise<void> {
        const reader = (response as Response).body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const next = await reader.read();
            if (next.done) return;
            buffer += decoder.decode(next.value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';
            for (const event of events) {
                const line = event.split('\n').find((part) => part.startsWith('data: '));
                if (!line) continue;
                try { await this.handleLease(JSON.parse(line.slice(6))); } catch { /* malformed = PAS-FAIT path */ }
            }
        }
    }

    async connectSse(): Promise<void> {
        const token = await this.deps.getAccessToken();
        if (!token) return;
        const response = await this.deps.fetch(
            `${this.base}/streams/cowork-devices/${encodeURIComponent(this.deps.deviceIdentity.deviceId)}/leases/sse`,
            { headers: await this.deliveryHeaders(token) },
        );
        if (response.ok) await this.consumeSse(response);
    }

    async stop(): Promise<void> {
        const token = await this.deps.getAccessToken();
        if (!token) return;
        await Promise.all([...this.active].map(async (leaseId) => {
            await this.deps.fetch(`${this.base}/chrome-extension/cowork-devices/leases/${encodeURIComponent(leaseId)}/revoke`, {
                method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'local_stop' }),
            });
        }));
        this.active.clear();
    }

    async handleLease(raw: unknown): Promise<void> {
        const lease = raw as DeliveredLease;
        if (!lease || typeof lease.leaseId !== 'string' || this.active.has(lease.leaseId)) return;
        const capability = lease.scope?.capability;
        const envelope = lease.scope?.serverEnvelope;
        if (isEnvelope(envelope) && !this.keys.has(envelope.kid)) await this.refreshServerKeys();
        if (!isCapability(capability) || !isEnvelope(envelope) || !this.verify(lease, capability, envelope)) return;
        this.active.add(lease.leaseId);
        try {
            const token = await this.deps.getAccessToken();
            if (!token || !(await this.acknowledge(token, lease))) return;
            const action = lease.scope?.action;
            const args = action && typeof action === 'object' && !Array.isArray(action) ? action as Record<string, unknown> : {};
            const result = await runDesktopToolCall(
                { toolCallId: lease.leaseId, name: capability, arguments: args },
                { consent: this.deps.consent, context: this.deps.context },
            );
            await this.complete(token, lease, result.error ? 'PAS-FAIT' : 'FAIT');
        } catch {
            const token = await this.deps.getAccessToken();
            if (token && typeof lease.leaseId === 'string' && typeof lease.nonce === 'string') await this.complete(token, lease, 'PAS-FAIT');
        } finally {
            this.active.delete(lease.leaseId);
        }
    }

    private verify(lease: DeliveredLease, capability: string, envelope: Envelope): boolean {
        const expiry = new Date(lease.expiresAt);
        if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) return false;
        const jwk = this.keys.get(envelope.kid);
        if (!jwk) return false;
        try {
            return verify(null, Buffer.from(canonicalEnvelope({ leaseId: lease.leaseId, capability, targetDeviceId: this.deps.deviceIdentity.deviceId, nonce: lease.nonce, expiry: expiry.toISOString() })), createPublicKey({ key: jwk as never, format: 'jwk' }), Buffer.from(envelope.mac, 'base64url'));
        } catch { return false; }
    }

    private readonly keys = new Map<string, Jwk>();

    async refreshServerKeys(): Promise<boolean> {
        const origin = new URL(this.base).origin;
        const response = await this.deps.fetch(`${origin}/.well-known/jwks.json`);
        if (!response.ok) return false;
        const payload = await response.json() as { keys?: unknown };
        if (!Array.isArray(payload.keys)) return false;
        this.keys.clear();
        for (const key of payload.keys) {
            if (key && typeof key === 'object' && typeof (key as Jwk).kid === 'string') this.keys.set((key as Jwk).kid!, key as Jwk);
        }
        return this.keys.size > 0;
    }

    private async deliveryHeaders(token: string): Promise<Record<string, string>> {
        const issuedAtMs = Date.now();
        return {
            Authorization: `Bearer ${token}`,
            'x-cowork-device-proof-at': String(issuedAtMs),
            'x-cowork-device-proof': await this.deps.deviceIdentity.sign(deliveryPayload(this.deps.deviceIdentity.deviceId, issuedAtMs)),
        };
    }

    private async acknowledge(token: string, lease: DeliveredLease): Promise<boolean> {
        const signature = await this.deps.deviceIdentity.sign(`cowork-lease-ack-v1:${lease.leaseId}.${lease.nonce}`);
        const response = await this.deps.fetch(`${this.base}/chrome-extension/cowork-devices/leases/${encodeURIComponent(lease.leaseId)}/ack`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: this.deps.deviceIdentity.deviceId, signature }),
        });
        return response.ok;
    }

    private async complete(token: string, lease: DeliveredLease, outcome: 'FAIT' | 'PAS-FAIT'): Promise<void> {
        const signature = await this.deps.deviceIdentity.sign(`cowork-lease-result-v1:${lease.leaseId}.${lease.nonce}.${outcome}`);
        await this.deps.fetch(`${this.base}/chrome-extension/cowork-devices/leases/${encodeURIComponent(lease.leaseId)}/result`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: this.deps.deviceIdentity.deviceId, outcome, signature }),
        });
    }
}
