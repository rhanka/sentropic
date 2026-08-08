import { describe, expect, it } from 'vitest';
import { createMockCapabilityProvider } from '../src/capability/index.js';
import { ForegroundSurfaceGuard } from '../src/capability/foreground-surface.js';
import {
    ConsentManager,
    createMemoryConsentStore,
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
        store: createMemoryConsentStore(),
        prompt: async () => 'allow_once',
    });

const allowInputOnce = () =>
    new ConsentManager({
        store: createMemoryConsentStore(),
        prompt: async () => 'allow_once',
    });

const toolContext = (provider: ReturnType<typeof createMockCapabilityProvider>): DesktopToolContext => ({
    provider,
    surfaceGuard: new ForegroundSurfaceGuard({ measure: async () => ({ hwnd: '1', processId: 1, executable: 'C:\\Windows\\notepad.exe', title: 'Untitled - Notepad' }) }),
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
            { screen: 0 },
            toolContext(provider),
        )) as { ok: boolean; image: string; width: number };

        expect(result.ok).toBe(true);
        expect(result.width).toBe(1920);
        expect(result.image).toBe('data:image/png;base64,QUJD');
        expect(provider.calls).toEqual([
            { kind: 'captureScreen', options: { screen: 0 } },
        ]);
    });

    it('rejects malformed, narrowed, or non-default capture arguments before the provider', async () => {
        const provider = createMockCapabilityProvider();
        await expect(screenCaptureExecutor({ screen: -3, region: { x: 'bad' } }, { provider } as DesktopToolContext))
            .rejects.toThrow(/default full primary display/);
        await expect(screenCaptureExecutor({ region: { x: 0, y: 0, width: 1, height: 1 } }, { provider } as DesktopToolContext))
            .rejects.toThrow(/default full primary display/);
        expect(provider.calls).toEqual([]);
    });
});

describe('input_action executor (hands)', () => {
    it('dispatches click to provider.mouseClick with the button', async () => {
        const provider = createMockCapabilityProvider();
        await inputActionExecutor({ action: 'click', x: 10, y: 20, button: 'right' }, toolContext(provider));
        expect(provider.calls).toEqual([{ kind: 'mouseClick', x: 10, y: 20, button: 'right' }]);
    });

    it('dispatches only type and scroll', async () => {
        const provider = createMockCapabilityProvider();
        await inputActionExecutor({ action: 'type', text: 'hello' }, toolContext(provider));
        await inputActionExecutor({ action: 'scroll', dx: 0, dy: 120 }, toolContext(provider));
        expect(provider.calls).toEqual([
            { kind: 'type', text: 'hello' },
            { kind: 'scroll', dx: 0, dy: 120 },
        ]);
    });

    it('fails closed without a measurement or when the surface drifts during provider entry', async () => {
        const absent = createMockCapabilityProvider();
        await expect(inputActionExecutor({ action: 'click', x: 1, y: 2 }, { provider: absent } as DesktopToolContext))
            .rejects.toThrow(/measured foreground-surface guard/);
        expect(absent.calls).toEqual([]);

        let measurements = 0;
        const drifted = createMockCapabilityProvider();
        const context: DesktopToolContext = {
            provider: drifted,
            surfaceGuard: new ForegroundSurfaceGuard({ measure: async () => (++measurements < 3
                ? { hwnd: '1', processId: 1, executable: 'notepad.exe', title: 'Notepad' }
                : { hwnd: '2', processId: 2, executable: 'powershell.exe', title: 'PowerShell' }) }),
        };
        await expect(inputActionExecutor({ action: 'click', x: 1, y: 2 }, context)).rejects.toThrow(/drifted or is unavailable/);
        expect(drifted.calls).toEqual([]);
    });

    it('denies key chords and every control/submission character before the provider', async () => {
        const provider = createMockCapabilityProvider();
        await expect(inputActionExecutor({ action: 'key', combo: 'Ctrl+S' }, { provider } as DesktopToolContext))
            .rejects.toThrow(/denied action/);
        for (const text of ['submit\n', 'submit\r', 'submit\t', 'submit\u001b', 'submit\u0085', 'submit\u2028', 'submit\u2029', 'submit\u200d']) {
            await expect(inputActionExecutor({ action: 'type', text }, { provider } as DesktopToolContext))
                .rejects.toThrow(/denies control/);
        }
        expect(provider.calls).toEqual([]);
    });

    it('throws on missing click coordinates and unknown actions', async () => {
      const provider = createMockCapabilityProvider();
      await expect(
        inputActionExecutor({ action: 'click' }, { provider } as DesktopToolContext),
        ).rejects.toThrow(/exact click/);
      await expect(
        inputActionExecutor({ action: 'teleport' }, { provider } as DesktopToolContext),
        ).rejects.toThrow(/exact click/);
    });

    it('rejects malformed clicks and invalid scroll shapes without normalizing them into an actuation', async () => {
        const provider = createMockCapabilityProvider();
        const context = toolContext(provider);
        for (const args of [
            { action: 'click', x: 1, y: 2, button: 'right ' },
            { action: 'click', x: 1.5, y: 2 },
            { action: 'click', x: 1, y: 2, extra: true },
            { action: 'scroll', dx: 0 },
            { action: 'scroll', dx: 0, dy: 0 },
        ]) await expect(inputActionExecutor(args, context)).rejects.toThrow(/exact click/);
        expect(provider.calls).toEqual([]);
    });
});

describe('runDesktopToolCall — consent gate', () => {
    const context = (): DesktopToolContext => toolContext(createMockCapabilityProvider());

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
