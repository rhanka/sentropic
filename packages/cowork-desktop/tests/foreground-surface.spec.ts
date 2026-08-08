import { describe, expect, it } from 'vitest';

import { ForegroundSurfaceGuard } from '../src/capability/foreground-surface.js';

const measuredNotepad = (overrides: Record<string, unknown> = {}) => ({
    hwnd: '1', processId: 7, executable: 'C:\\Windows\\System32\\notepad.exe', title: 'Untitled - Notepad',
    windowsDirectory: 'C:\\Windows', signatureStatus: 'Valid', signerSubject: 'CN=Microsoft Corporation',
    clientArea: { left: 100, top: 200, right: 900, bottom: 700 }, ...overrides,
});

describe('ForegroundSurfaceGuard', () => {
    it('fails closed when the measurement is absent, non-Notepad, or drifts after consent', async () => {
        let current: ReturnType<typeof measuredNotepad> | null = null;
        const guard = new ForegroundSurfaceGuard({ measure: async () => current });
        await expect(guard.acquire()).rejects.toThrow(/not the allowlisted/);
        current = measuredNotepad();
        const token = await guard.acquire();
        current = measuredNotepad({ hwnd: '2', processId: 8, executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', title: 'Administrator: PowerShell' });
        await expect(guard.recheck(token)).rejects.toThrow(/drifted or is unavailable/);
    });

    it('rejects a copied or unsigned notepad.exe and retains the full signed identity in its token', async () => {
        const copied = new ForegroundSurfaceGuard({ measure: async () => measuredNotepad({ executable: 'C:\\Users\\Cowork\\notepad.exe' }) });
        await expect(copied.acquire()).rejects.toThrow(/not the allowlisted/);
        const unsigned = new ForegroundSurfaceGuard({ measure: async () => measuredNotepad({ signatureStatus: 'NotSigned', signerSubject: '' }) });
        await expect(unsigned.acquire()).rejects.toThrow(/not the allowlisted/);
        const token = await new ForegroundSurfaceGuard({ measure: async () => measuredNotepad() }).acquire();
        expect(token.executable).toBe('c:\\windows\\system32\\notepad.exe');
        expect(token.signerSubject).toBe('CN=Microsoft Corporation');
    });

    it('requires the same measured HWND and process after a native-module await', async () => {
        const surface = measuredNotepad();
        const guard = new ForegroundSurfaceGuard({ measure: async () => surface });
        const token = await guard.acquire();
        await expect(guard.nativeGuard(token).recheckAfterNativeAwait()).resolves.toBeUndefined();
    });

    it('refuses coordinates outside the measured HWND and delegates only in-bounds clicks to the targeted primitive', async () => {
        const calls: unknown[] = [];
        const surface = measuredNotepad();
        const guard = new ForegroundSurfaceGuard({
            measure: async () => surface,
            targetedInput: async (_token, input) => { calls.push(input); },
        });
        const token = await guard.acquire();
        const native = guard.nativeGuard(token);
        expect(() => native.assertClickInBounds?.(99, 200)).toThrow(/outside the measured/);
        await expect(native.targetedInput?.({ kind: 'click', x: 100, y: 200, button: 'right' })).resolves.toBeUndefined();
        expect(calls).toEqual([{ kind: 'click', x: 100, y: 200, button: 'right' }]);
    });
});
