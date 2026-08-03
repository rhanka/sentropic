import { describe, expect, it } from 'vitest';
import { createMockCapabilityProvider } from '../src/capability/index.js';
import {
    ConsentManager,
    createMemoryConsentStore,
    DESKTOP_ORIGIN,
} from '../src/consent/index.js';
import {
    desktopToolDefinitions,
    runDesktopToolCall,
    screenCaptureExecutor,
    inputActionExecutor,
    type DesktopToolContext,
} from '../src/tools/index.js';

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

describe('tool definitions', () => {
    it('advertises exactly screen_capture and input_action', () => {
        expect(desktopToolDefinitions.map((d) => d.name).sort()).toEqual([
            'input_action',
            'screen_capture',
        ]);
    });
});

describe('screen_capture executor (eyes)', () => {
    it('calls provider.captureScreen with parsed options and returns a data-URI image', async () => {
        const provider = createMockCapabilityProvider({
            capture: { base64: 'QUJD', mimeType: 'image/png', width: 1920, height: 1080 },
        });
        const result = (await screenCaptureExecutor(
            { screen: 1, region: { x: 0, y: 0, width: 100, height: 50 } },
            { provider } as DesktopToolContext,
        )) as { ok: boolean; image: string; width: number };

        expect(result.ok).toBe(true);
        expect(result.width).toBe(1920);
        expect(result.image).toBe('data:image/png;base64,QUJD');
        expect(provider.calls).toEqual([
            { kind: 'captureScreen', options: { screen: 1, region: { x: 0, y: 0, width: 100, height: 50 } } },
        ]);
    });

    it('ignores an invalid region and a negative screen index', async () => {
        const provider = createMockCapabilityProvider();
        await screenCaptureExecutor({ screen: -3, region: { x: 'bad' } }, { provider } as DesktopToolContext);
        expect(provider.calls).toEqual([{ kind: 'captureScreen', options: { screen: undefined, region: undefined } }]);
    });
});

describe('input_action executor (hands)', () => {
    it('dispatches click to provider.mouseClick with the button', async () => {
        const provider = createMockCapabilityProvider();
        await inputActionExecutor({ action: 'click', x: 10, y: 20, button: 'right' }, { provider } as DesktopToolContext);
        expect(provider.calls).toEqual([{ kind: 'mouseClick', x: 10, y: 20, button: 'right' }]);
    });

    it('dispatches only type and scroll', async () => {
        const provider = createMockCapabilityProvider();
        await inputActionExecutor({ action: 'type', text: 'hello' }, { provider } as DesktopToolContext);
        await inputActionExecutor({ action: 'scroll', dx: 0, dy: 120 }, { provider } as DesktopToolContext);
        expect(provider.calls).toEqual([
            { kind: 'type', text: 'hello' },
            { kind: 'scroll', dx: 0, dy: 120 },
        ]);
    });

    it('denies key chords, Enter, and submission characters before the provider', async () => {
        const provider = createMockCapabilityProvider();
        await expect(inputActionExecutor({ action: 'key', combo: 'Ctrl+S' }, { provider } as DesktopToolContext))
            .rejects.toThrow(/denied action/);
        await expect(inputActionExecutor({ action: 'type', text: 'submit\n' }, { provider } as DesktopToolContext))
            .rejects.toThrow(/denies Enter/);
        expect(provider.calls).toEqual([]);
    });

    it('throws on missing click coordinates and unknown actions', async () => {
        const provider = createMockCapabilityProvider();
        await expect(
            inputActionExecutor({ action: 'click' }, { provider } as DesktopToolContext),
        ).rejects.toThrow(/numeric x and y/);
        await expect(
            inputActionExecutor({ action: 'teleport' }, { provider } as DesktopToolContext),
        ).rejects.toThrow(/unknown action/);
    });
});

describe('runDesktopToolCall — consent gate', () => {
    const context = (): DesktopToolContext => ({ provider: createMockCapabilityProvider() });

    it('executes when consent allows and returns a ToolResult', async () => {
        const ctx = context();
        const result = await runDesktopToolCall(
            { toolCallId: 'c1', name: 'screen_capture', arguments: {} },
            { consent: allowAll(), context: ctx },
        );
        expect(result.toolCallId).toBe('c1');
        expect(result.error).toBeUndefined();
        expect(JSON.parse(result.output).ok).toBe(true);
    });

    it('does NOT run the executor when consent denies (default deny)', async () => {
        const ctx = context();
        const consent = new ConsentManager({ store: createMemoryConsentStore() });
        const result = await runDesktopToolCall(
            { toolCallId: 'c2', name: 'input_action', arguments: { action: 'click', x: 1, y: 2 } },
            { consent, context: ctx },
        );
        expect(result.error).toMatch(/default deny|requires user consent/);
        expect(JSON.parse(result.output).denied).toBe(true);
        expect((ctx.provider as ReturnType<typeof createMockCapabilityProvider>).calls).toHaveLength(0);
    });

    it('returns an error result for an unknown tool', async () => {
        const result = await runDesktopToolCall(
            { toolCallId: 'c3', name: 'mystery', arguments: {} },
            { consent: allowInputOnce(), context: context() },
        );
        expect(result.error).toMatch(/Unknown desktop tool/);
    });

    it('reports executor errors back as a tool error (consent allowed)', async () => {
        const result = await runDesktopToolCall(
            { toolCallId: 'c4', name: 'input_action', arguments: { action: 'click' } },
            { consent: allowInputOnce(), context: context() },
        );
        expect(result.error).toMatch(/numeric x and y/);
        expect(JSON.parse(result.output).ok).toBe(false);
    });
});
