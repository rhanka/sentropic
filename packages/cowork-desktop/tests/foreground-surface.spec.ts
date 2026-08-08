import { describe, expect, it } from 'vitest';

import { ForegroundSurfaceGuard } from '../src/capability/foreground-surface.js';

describe('ForegroundSurfaceGuard', () => {
    it('fails closed when the measurement is absent, non-Notepad, or drifts after consent', async () => {
        let current: { hwnd: string; processId: number; executable: string; title: string } | null = null;
        const guard = new ForegroundSurfaceGuard({ measure: async () => current });
        await expect(guard.acquire()).rejects.toThrow(/not the allowlisted/);
        current = { hwnd: '1', processId: 7, executable: 'C:\\Windows\\System32\\notepad.exe', title: 'Untitled - Notepad' };
        const token = await guard.acquire();
        current = { hwnd: '2', processId: 8, executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', title: 'Administrator: PowerShell' };
        await expect(guard.recheck(token)).rejects.toThrow(/drifted or is unavailable/);
    });

    it('requires the same measured HWND and process after a native-module await', async () => {
        const surface = { hwnd: '1', processId: 7, executable: 'notepad.exe', title: 'Untitled - Notepad' };
        const guard = new ForegroundSurfaceGuard({ measure: async () => surface });
        const token = await guard.acquire();
        await expect(guard.nativeGuard(token).recheckAfterNativeAwait()).resolves.toBeUndefined();
    });
});
