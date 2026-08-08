import { describe, expect, it, vi } from 'vitest';
import {
    ConsentManager,
    createMemoryConsentStore,
    DESKTOP_ORIGIN,
} from '../src/consent/index.js';
import type { ToolPermissionEntry } from '@sentropic/cowork-bridge/permissions';

const allowAlwaysEntry = (toolName: string): ToolPermissionEntry => ({
    toolName,
    origin: DESKTOP_ORIGIN,
    policy: 'allow',
    updatedAt: new Date().toISOString(),
});

describe('ConsentManager — default deny', () => {
    it('denies (default) when no policy and no prompt', async () => {
        const consent = new ConsentManager({ store: createMemoryConsentStore() });
        const verdict = await consent.check('screen_capture');
        expect(verdict).toEqual({ decision: 'deny', source: 'default' });
    });

    it('deletes and ignores a persisted screen-capture allow policy', async () => {
        const store = createMemoryConsentStore([allowAlwaysEntry('screen_capture')]);
        const consent = new ConsentManager({ store });
        const verdict = await consent.check('screen_capture');
        expect(verdict).toEqual({ decision: 'deny', source: 'default' });
        expect(await store.readEntries()).toEqual([]);
    });

    it('honors a persisted deny_always policy', async () => {
        const store = createMemoryConsentStore([
            { toolName: 'input_action', origin: DESKTOP_ORIGIN, policy: 'deny', updatedAt: new Date().toISOString() },
        ]);
        const consent = new ConsentManager({ store });
        const verdict = await consent.check('input_action');
        expect(verdict).toEqual({ decision: 'deny', source: 'deny_always' });
    });
});

describe('ConsentManager — prompt decisions', () => {
    it('allow_once allows the call but persists nothing', async () => {
        const store = createMemoryConsentStore();
        const prompt = vi.fn().mockResolvedValue('allow_once');
        const consent = new ConsentManager({ store, prompt });

        const verdict = await consent.check('screen_capture');
        expect(verdict).toEqual({ decision: 'allow', source: 'allow_once' });
        expect(await store.readEntries()).toHaveLength(0);
    });

    it('treats remote allow_always as allow-once and persists no policy', async () => {
        const store = createMemoryConsentStore();
        const prompt = vi.fn().mockResolvedValue('allow_always');
        const consent = new ConsentManager({ store, prompt });

        const first = await consent.check('screen_capture');
        expect(first).toEqual({ decision: 'allow', source: 'allow_once' });
        expect(await store.readEntries()).toHaveLength(0);
    });

    it('deny_once denies without persisting', async () => {
        const store = createMemoryConsentStore();
        const prompt = vi.fn().mockResolvedValue('deny_once');
        const consent = new ConsentManager({ store, prompt });

        const verdict = await consent.check('input_action');
        expect(verdict).toEqual({ decision: 'deny', source: 'default' });
        expect(await store.readEntries()).toHaveLength(0);
    });

    it('deny_always denies and persists a deny policy', async () => {
        const store = createMemoryConsentStore();
        const prompt = vi.fn().mockResolvedValue('deny_always');
        const consent = new ConsentManager({ store, prompt });

        const verdict = await consent.check('input_action');
        expect(verdict).toEqual({ decision: 'deny', source: 'deny_always' });
        expect(await store.readEntries()).toHaveLength(1);
    });

    it('revokeAll clears every persisted policy', async () => {
        const store = createMemoryConsentStore([allowAlwaysEntry('screen_capture')]);
        const consent = new ConsentManager({ store });
        await consent.revokeAll();
        expect(await store.readEntries()).toHaveLength(0);
        expect(await consent.check('screen_capture')).toEqual({
            decision: 'deny',
            source: 'default',
        });
    });
});

describe('ConsentManager — remote lease receipt', () => {
    it('binds Allow once to one lease/action and consumes it exactly once', async () => {
        const consent = new ConsentManager({
            store: createMemoryConsentStore(),
            prompt: async () => 'allow_once',
        });
        const receipt = await consent.requestRemoteAllowOnce({
            toolName: 'input_action', leaseId: 'lease-1', actionDigest: 'digest-1', details: { action: 'click' },
        });
        expect(receipt).not.toBeNull();
        expect(consent.consumeRemoteAllowOnce(receipt!, {
            toolName: 'input_action', leaseId: 'lease-1', actionDigest: 'digest-1',
        })).toBe(true);
        expect(consent.consumeRemoteAllowOnce(receipt!, {
            toolName: 'input_action', leaseId: 'lease-1', actionDigest: 'digest-1',
        })).toBe(false);
    });

    it('does not reuse or honor a stale persisted allow for either remote capability', async () => {
        const store = createMemoryConsentStore([
            allowAlwaysEntry('screen_capture'),
            allowAlwaysEntry('input_action'),
        ]);
        const prompt = vi.fn().mockResolvedValue('allow_once');
        const consent = new ConsentManager({ store, prompt });
        await expect(consent.requestRemoteAllowOnce({
            toolName: 'screen_capture', leaseId: 'capture-1', actionDigest: 'capture-digest',
        })).resolves.toMatchObject({ leaseId: 'capture-1' });
        await expect(consent.requestRemoteAllowOnce({
            toolName: 'input_action', leaseId: 'input-1', actionDigest: 'input-digest',
        })).resolves.toMatchObject({ leaseId: 'input-1' });
        expect(await store.readEntries()).toEqual([]);
        expect(prompt).toHaveBeenCalledTimes(2);
    });
});
