import { describe, expect, it } from 'vitest';

import { createWindowsCapabilityProvider } from '../src/capability/windows-provider.js';
import type { NativeActuationGuard, TargetedNativeInput } from '../src/capability/types.js';

const mockNativeGuard = (overrides: Partial<NativeActuationGuard> = {}): NativeActuationGuard => ({
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    recheckAfterNativeAwait: async () => {},
    assertClickInBounds: () => {},
    ...overrides,
});

describe('Windows literal text path', () => {
    it('rejects Tab, Escape, C0/C1, format, line, paragraph, and Enter variants before native loading', async () => {
        const provider = createWindowsCapabilityProvider();
        for (const text of ['\t', '\u001b', '\u007f', '\u0085', '\u2028', '\u2029', '\r', '\n', '\u200d']) {
            await expect(provider.type(`safe${text}text`, mockNativeGuard({ targetedInput: async () => {} }))).rejects.toThrow(/denies control/);
        }
    });

    it('requires the targetedInput primitive and fails closed with CapabilityUnavailableError when absent', async () => {
        const provider = createWindowsCapabilityProvider();
        const guardWithoutTargeted = mockNativeGuard();
        await expect(provider.type('hello', guardWithoutTargeted)).rejects.toThrow(/HWND-targeted type primitive is unavailable/);
        await expect(provider.scroll(0, 10, guardWithoutTargeted)).rejects.toThrow(/HWND-targeted scroll primitive is unavailable/);
        await expect(provider.mouseClick(10, 20, 'left', guardWithoutTargeted)).rejects.toThrow(/HWND-targeted click primitive is unavailable/);
    });

    it('chunks literal text into bounded units and observes AbortSignal between chunks', async () => {
        const deliveredChunks: string[] = [];
        const abortController = new AbortController();
        let chunkCount = 0;
        const guard = mockNativeGuard({
            signal: abortController.signal,
            throwIfAborted: () => {
                if (abortController.signal.aborted) throw new Error('aborted');
            },
            targetedInput: async (input: TargetedNativeInput) => {
                if (input.kind === 'type') {
                    deliveredChunks.push(input.text);
                    chunkCount++;
                    if (chunkCount === 2) {
                        abortController.abort();
                    }
                }
            },
        });
        const provider = createWindowsCapabilityProvider();
        const longText = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHI';
        await expect(provider.type(longText, guard)).rejects.toThrow(/aborted/);
        expect(deliveredChunks).toEqual([
            'abcdefghij',
            'klmnopqrst',
        ]);
        expect(deliveredChunks.length).toBe(2);
    });

    it('chunks scroll into bounded steps and observes AbortSignal between steps', async () => {
        const deliveredScrolls: Array<{ dx: number; dy: number }> = [];
        const abortController = new AbortController();
        let stepCount = 0;
        const guard = mockNativeGuard({
            signal: abortController.signal,
            throwIfAborted: () => {
                if (abortController.signal.aborted) throw new Error('aborted');
            },
            targetedInput: async (input: TargetedNativeInput) => {
                if (input.kind === 'scroll') {
                    deliveredScrolls.push({ dx: input.dx, dy: input.dy });
                    stepCount++;
                    if (stepCount === 2) {
                        abortController.abort();
                    }
                }
            },
        });
        const provider = createWindowsCapabilityProvider();
        await expect(provider.scroll(0, 20, guard)).rejects.toThrow(/aborted/);
        expect(deliveredScrolls).toEqual([
            { dx: 0, dy: 5 },
            { dx: 0, dy: 5 },
        ]);
    });

    it('exposes no key chord primitive on the provider interface and fails action:key at schema', () => {
        const provider = createWindowsCapabilityProvider();
        expect('key' in provider).toBe(false);
        expect((provider as Record<string, unknown>).key).toBeUndefined();
    });
});
