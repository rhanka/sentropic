import { createPublicKey, verify } from 'node:crypto';

import type { DeviceIdentitySigner, FetchLike } from '@sentropic/cowork-bridge/auth';
import type { ConsentManager } from '../consent/index.js';
import { runDesktopToolCall, type DesktopToolContext } from '../tools/index.js';
import { remoteActionDigest, remotePayloadDigest } from '../tools/action-digest.js';
import { parseCoworkInputAction } from '../tools/input-action-schema.js';
import type { ForegroundSurface } from '../capability/index.js';

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

const consentDetails = (capability: 'screen_capture' | 'input_action', action: Record<string, unknown>, surface: ForegroundSurface) => {
    const foreground = {
        executable: surface.executable,
        canonicalExecutable: surface.executable,
        signerSubject: surface.signerSubject,
        clientArea: surface.clientArea,
        windowTitle: surface.title,
        hwnd: surface.hwnd,
    };
    if (capability === 'screen_capture') return { foreground, capture: { screen: 'primary full display' } };
    if (action.action === 'click') return { foreground, coordinates: { x: action.x, y: action.y, button: action.button } };
    if (action.action === 'scroll') return { foreground, scroll: { dx: action.dx ?? 0, dy: action.dy ?? 0 } };
    return { foreground, typedText: typeof action.text === 'string' ? action.text : '' };
};

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
    private readonly active = new Map<string, { cancelled: boolean; abort: AbortController }>();
    private stopped = false;
    private executionTail: Promise<void> = Promise.resolve();

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
        // Cancellation is synchronous. A pending foreground prompt observes it
        // before it can ask the server for the final acknowledgement permit.
        const active = [...this.active.entries()];
        this.stopped = true;
        for (const [, execution] of active) {
            execution.cancelled = true;
            execution.abort?.abort();
        }
        const token = await this.deps.getAccessToken();
        if (!token) return;
        await Promise.all(active.map(([leaseId]) => this.revoke(token, leaseId, 'local_stop')));
    }

    async handleLease(raw: unknown): Promise<void> {
        const lease = raw as DeliveredLease;
        if (this.stopped || !lease || typeof lease.leaseId !== 'string' || this.active.has(lease.leaseId)) return;
        const capability = lease.scope?.capability;
        const envelope = lease.scope?.serverEnvelope;
        if (isEnvelope(envelope) && !this.keys.has(envelope.kid)) await this.refreshServerKeys();
        if (!isCapability(capability) || !isEnvelope(envelope) || !this.verify(lease, capability, envelope)) return;
        const execution = { cancelled: false, abort: new AbortController() };
        this.active.set(lease.leaseId, execution);
        let claimed = false;
        try {
            const token = await this.deps.getAccessToken();
            const rawAction = lease.scope?.action;
            const parsedInputAction = capability === 'input_action' ? parseCoworkInputAction(rawAction) : null;
            if (capability === 'input_action' && !parsedInputAction) {
                if (token) await this.cancelBeforeStart(token, lease, 'invalid_input_action');
                return;
            }
            const args = parsedInputAction ?? (rawAction && typeof rawAction === 'object' && !Array.isArray(rawAction) ? rawAction as Record<string, unknown> : {});
            const surface = await this.acquireSurface();
            if (!surface) {
                if (token) await this.cancelBeforeStart(token, lease, 'surface_guard_failed');
                return;
            }
            const receipt = await this.deps.consent.requestRemoteAllowOnce({
                toolName: capability,
                leaseId: lease.leaseId,
                actionDigest: remoteActionDigest(args),
                details: consentDetails(capability, args, surface),
            });
            if (!token || !receipt || !this.canEnter(execution, lease) || !(await this.recheckSurface(surface))) {
                if (token) await this.cancelBeforeStart(token, lease, execution.cancelled || this.stopped ? 'local_stop' : 'local_not_done');
                return;
            }
            // The atomic issued->acknowledged response is the final server
            // lease/device permit. It is deliberately after consent and before
            // the provider call, so revocation/deletion/expiry fails closed.
            if (!(await this.acknowledge(token, lease)) || !this.canEnter(execution, lease)) {
                if (execution.cancelled || this.stopped || !this.isLocallyValid(lease)) await this.cancelBeforeStart(token, lease, 'local_not_done');
                return;
            }
            const start = await this.claimExecution(token, lease);
            if (start !== 'started') {
                if (start === 'cancelled') await this.acknowledgeCancellation(token, lease);
                return;
            }
            claimed = true;
            const release = await this.enterExecution(execution);
            if (!release) {
                await this.complete(token, lease, 'PAS-FAIT');
                return;
            }
            try {
                if (!this.canEnter(execution, lease)) {
                    await this.complete(token, lease, 'PAS-FAIT');
                    return;
                }
            const result = await runDesktopToolCall(
                { toolCallId: lease.leaseId, name: capability, arguments: args },
                { consent: this.deps.consent, context: { ...this.deps.context, surfaceToken: surface }, remoteReceipt: receipt },
            );
            const resultPayload = result.error ? undefined : JSON.parse(result.output) as Record<string, unknown>;
            await this.complete(token, lease, result.error ? 'PAS-FAIT' : 'FAIT', resultPayload);
            } finally { release(); }
        } catch {
            const token = await this.deps.getAccessToken();
            if (claimed && token && typeof lease.leaseId === 'string' && typeof lease.nonce === 'string') await this.complete(token, lease, 'PAS-FAIT');
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

    private isLocallyValid(lease: DeliveredLease): boolean {
        const expiry = new Date(lease.expiresAt);
        return Number.isFinite(expiry.getTime()) && expiry.getTime() > Date.now();
    }

    private canEnter(execution: { cancelled: boolean; abort: AbortController }, lease: DeliveredLease): boolean {
        return !this.stopped && !execution.cancelled && !execution.abort.signal.aborted && this.isLocallyValid(lease);
    }

    private async acquireSurface(): Promise<ForegroundSurface | null> {
        try { return await this.deps.context.surfaceGuard?.acquire() ?? null; } catch { return null; }
    }

    private async recheckSurface(surface: ForegroundSurface): Promise<boolean> {
        try { await this.deps.context.surfaceGuard?.recheck(surface); return Boolean(this.deps.context.surfaceGuard); } catch { return false; }
    }

    /** One provider entry at a time; a queued entry wakes on Stop and fails closed. */
    private async enterExecution(execution: { cancelled: boolean; abort: AbortController }): Promise<(() => void) | null> {
        let release!: () => void;
        const previous = this.executionTail;
        this.executionTail = new Promise<void>((resolve) => { release = resolve; });
        if (this.stopped || execution.cancelled || execution.abort.signal.aborted) {
            release();
            return null;
        }
        await Promise.race([
            previous,
            new Promise<void>((resolve) => execution.abort.signal.addEventListener('abort', () => resolve(), { once: true })),
        ]);
        if (this.stopped || execution.cancelled || execution.abort.signal.aborted) {
            release();
            return null;
        }
        return release;
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

    private async claimExecution(token: string, lease: DeliveredLease): Promise<'started' | 'cancelled' | 'denied'> {
        const signature = await this.deps.deviceIdentity.sign(`cowork-lease-start-v1:${lease.leaseId}.${lease.nonce}`);
        const response = await this.deps.fetch(`${this.base}/chrome-extension/cowork-devices/leases/${encodeURIComponent(lease.leaseId)}/start`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: this.deps.deviceIdentity.deviceId, signature }),
        });
        if (response.ok) return 'started';
        const payload = await response.json().catch(() => null) as { reason?: unknown } | null;
        return payload?.reason === 'cancelled' ? 'cancelled' : 'denied';
    }

    private async acknowledgeCancellation(token: string, lease: DeliveredLease): Promise<void> {
        const signature = await this.deps.deviceIdentity.sign(`cowork-lease-cancel-v1:${lease.leaseId}.${lease.nonce}`);
        await this.deps.fetch(`${this.base}/chrome-extension/cowork-devices/leases/${encodeURIComponent(lease.leaseId)}/cancel-ack`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: this.deps.deviceIdentity.deviceId, signature }),
        });
    }

    private async cancelBeforeStart(token: string, lease: DeliveredLease, reason: string): Promise<void> {
        await this.revoke(token, lease.leaseId, reason);
        await this.acknowledgeCancellation(token, lease);
    }

    private async complete(token: string, lease: DeliveredLease, outcome: 'FAIT' | 'PAS-FAIT', result?: Record<string, unknown>): Promise<void> {
        const signature = await this.deps.deviceIdentity.sign(`cowork-lease-result-v1:${lease.leaseId}.${lease.nonce}.${outcome}.${remotePayloadDigest(result)}`);
        await this.deps.fetch(`${this.base}/chrome-extension/cowork-devices/leases/${encodeURIComponent(lease.leaseId)}/result`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: this.deps.deviceIdentity.deviceId, outcome, ...(result ? { result } : {}), signature }),
        });
    }

    private async revoke(token: string, leaseId: string, reason: string): Promise<void> {
        await this.deps.fetch(`${this.base}/chrome-extension/cowork-devices/leases/${encodeURIComponent(leaseId)}/revoke`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
        });
    }
}
