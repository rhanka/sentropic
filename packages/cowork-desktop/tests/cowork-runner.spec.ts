import { describe, expect, it, vi } from 'vitest';
import { createMockCapabilityProvider } from '../src/capability/index.js';
import {
    ConsentManager,
    createMemoryConsentStore,
    DESKTOP_ORIGIN,
} from '../src/consent/index.js';
import { CoworkRunner } from '../src/runner/index.js';
import type { DesktopToolContext } from '../src/tools/index.js';

const allowAll = () =>
    new ConsentManager({
        store: createMemoryConsentStore([
            { toolName: '*', origin: DESKTOP_ORIGIN, policy: 'allow', updatedAt: new Date().toISOString() },
        ]),
    });

const allowInputOnce = () =>
    new ConsentManager({
        store: createMemoryConsentStore(),
        prompt: async () => 'allow_once',
    });

const statusPayload = (calls: Array<{ id: string; name: string; args: unknown }>) => ({
    state: 'awaiting_local_tool_results',
    pending_local_tool_calls: calls.map((c) => ({ tool_call_id: c.id, name: c.name, args: c.args })),
});

describe('CoworkRunner.handleStatusPayload', () => {
    it('executes desktop pending calls (consent allowed) and posts the results', async () => {
        const provider = createMockCapabilityProvider();
        const post = vi.fn().mockResolvedValue({ resumed: true });
        const runner = new CoworkRunner({
            consent: allowInputOnce(),
            context: { provider } as DesktopToolContext,
            postToolResults: post,
        });

        const results = await runner.handleStatusPayload(
            'msg-1',
            'stream-1',
            0,
            statusPayload([
                { id: 't1', name: 'screen_capture', args: {} },
                { id: 't2', name: 'input_action', args: { action: 'click', x: 5, y: 6 } },
            ]),
        );

        expect(results).toHaveLength(2);
        expect(provider.calls).toEqual([
            { kind: 'captureScreen', options: { screen: undefined, region: undefined } },
            { kind: 'mouseClick', x: 5, y: 6, button: 'left' },
        ]);
        expect(post).toHaveBeenCalledWith('msg-1', expect.arrayContaining([
            expect.objectContaining({ toolCallId: 't1', name: 'screen_capture' }),
            expect.objectContaining({ toolCallId: 't2', name: 'input_action' }),
        ]));
    });

    it('still posts denied results (default deny) without invoking the provider', async () => {
        const provider = createMockCapabilityProvider();
        const post = vi.fn().mockResolvedValue({ resumed: true });
        const runner = new CoworkRunner({
            consent: new ConsentManager({ store: createMemoryConsentStore() }),
            context: { provider } as DesktopToolContext,
            postToolResults: post,
        });

        const results = await runner.handleStatusPayload(
            'msg-2',
            'stream-2',
            0,
            statusPayload([{ id: 't1', name: 'input_action', args: { action: 'click', x: 1, y: 2 } }]),
        );

        expect(results?.[0].error).toMatch(/deny|consent/);
        expect(provider.calls).toHaveLength(0);
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('ignores a non-awaiting status payload', async () => {
        const post = vi.fn();
        const runner = new CoworkRunner({
            consent: allowAll(),
            context: { provider: createMockCapabilityProvider() } as DesktopToolContext,
            postToolResults: post,
        });
        const out = await runner.handleStatusPayload('m', 's', 0, { state: 'streaming' });
        expect(out).toBeNull();
        expect(post).not.toHaveBeenCalled();
    });

    it('ignores pending calls for non-desktop tools (e.g. tab_read)', async () => {
        const post = vi.fn();
        const runner = new CoworkRunner({
            consent: allowAll(),
            context: { provider: createMockCapabilityProvider() } as DesktopToolContext,
            postToolResults: post,
        });
        const out = await runner.handleStatusPayload(
            'm',
            's',
            0,
            statusPayload([{ id: 't1', name: 'tab_read', args: {} }]),
        );
        expect(out).toBeNull();
        expect(post).not.toHaveBeenCalled();
    });
});
