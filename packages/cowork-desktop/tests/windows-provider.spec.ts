import { describe, expect, it } from 'vitest';

import { createWindowsCapabilityProvider } from '../src/capability/windows-provider.js';

const nativeGuard = {
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    recheckAfterNativeAwait: async () => {},
};

describe('Windows literal text path', () => {
    it('rejects Tab, Escape, C0/C1, format, line, paragraph, and Enter variants before native loading', async () => {
        let nativeLoads = 0;
        const provider = createWindowsCapabilityProvider({
            resolveNativeModule: () => {
                nativeLoads += 1;
                return 'data:text/javascript,export%20const%20keyboard%3D%7Btype%3Aasync()%3D%3E%7B%7D%7D';
            },
        });
        for (const text of ['\t', '\u001b', '\u007f', '\u0085', '\u2028', '\u2029', '\r', '\n', '\u200d']) {
            await expect(provider.type(`safe${text}text`)).rejects.toThrow(/denies control/);
        }
        expect(nativeLoads).toBe(0);
    });

    it('uses only the literal keyboard primitive, never clipboard, IME, or key fallback', async () => {
        const calls: string[] = [];
        const source = encodeURIComponent([
            'export const keyboard = {',
            'type: async (text) => globalThis.__coworkLiteralCalls.push(text),',
            'pressKey: async () => { throw new Error("key fallback used") },',
            'releaseKey: async () => { throw new Error("key fallback used") },',
            '};',
        ].join(''));
        (globalThis as typeof globalThis & { __coworkLiteralCalls?: string[] }).__coworkLiteralCalls = calls;
        try {
            const provider = createWindowsCapabilityProvider({
                resolveNativeModule: () => `data:text/javascript,${source}`,
            });
            await provider.type('literal text only', nativeGuard);
            expect(calls).toEqual(['literal text only']);
        } finally {
            delete (globalThis as typeof globalThis & { __coworkLiteralCalls?: string[] }).__coworkLiteralCalls;
        }
    });
});
