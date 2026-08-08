import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { NativeActuationGuard } from './types.js';

const execFileAsync = promisify(execFile);
const NOTEPAD_EXECUTABLE = 'notepad.exe';

export type ForegroundSurface = {
    hwnd: string;
    processId: number;
    executable: string;
    title: string;
};

export interface ForegroundSurfaceProbe {
    measure(): Promise<ForegroundSurface | null>;
}

const normalizedExecutable = (value: string) => basename(value.replace(/\\/g, '/')).toLowerCase();

const isMeasuredNotepad = (surface: ForegroundSurface | null): surface is ForegroundSurface => Boolean(
    surface && typeof surface.hwnd === 'string' && surface.hwnd.length > 0
    && Number.isInteger(surface.processId) && surface.processId > 0
    && normalizedExecutable(surface.executable) === NOTEPAD_EXECUTABLE,
);

/**
 * The surface token makes a foreground measurement a capability, not display
 * text: the exact HWND/process/executable seen before consent must still exist
 * at provider entry. Missing measurement and every drift fail closed.
 */
export class ForegroundSurfaceGuard {
    constructor(private readonly probe: ForegroundSurfaceProbe) {}

    async acquire(): Promise<ForegroundSurface> {
        const surface = await this.probe.measure();
        if (!isMeasuredNotepad(surface)) throw new Error('Cowork refused: the measured foreground surface is not the allowlisted Notepad executable.');
        return { ...surface, executable: normalizedExecutable(surface.executable) };
    }

    async recheck(token: ForegroundSurface): Promise<void> {
        const current = await this.probe.measure();
        if (!isMeasuredNotepad(current)
            || current.hwnd !== token.hwnd
            || current.processId !== token.processId
            || normalizedExecutable(current.executable) !== token.executable) {
            throw new Error('Cowork refused: the measured foreground surface drifted or is unavailable.');
        }
    }

    nativeGuard(token: ForegroundSurface): NativeActuationGuard {
        return { recheckAfterNativeAwait: () => this.recheck(token) };
    }
}

const WINDOWS_FOREGROUND_SCRIPT = String.raw`
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SentropicForegroundSurface {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static object Read() {
    IntPtr hwnd = GetForegroundWindow(); if (hwnd == IntPtr.Zero) return null;
    uint pid; GetWindowThreadProcessId(hwnd, out pid); IntPtr process = OpenProcess(0x1000, false, pid); if (process == IntPtr.Zero) return null;
    try { var path = new StringBuilder(32768); uint length = 32768; if (!QueryFullProcessImageName(process, 0, path, ref length)) return null;
      var title = new StringBuilder(1024); GetWindowText(hwnd, title, title.Capacity);
      return new { hwnd = hwnd.ToInt64().ToString(), processId = pid, executable = path.ToString(), title = title.ToString() }; }
    finally { CloseHandle(process); }
  }
}
'@
[SentropicForegroundSurface]::Read() | ConvertTo-Json -Compress
`;

/** Windows UAT integration: actual HWND/process/executable foreground measurement. */
export const createWindowsForegroundSurfaceProbe = (): ForegroundSurfaceProbe => ({
    async measure(): Promise<ForegroundSurface | null> {
        if (process.platform !== 'win32') return null;
        try {
            const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_FOREGROUND_SCRIPT], {
                windowsHide: true, maxBuffer: 64 * 1024,
            });
            const value = JSON.parse(stdout.trim() || 'null') as ForegroundSurface | null;
            return value && typeof value === 'object' ? value : null;
        } catch { return null; }
    },
});
