import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { NativeActuationGuard, TargetedNativeInput } from './types.js';

const execFileAsync = promisify(execFile);
const NOTEPAD_EXECUTABLE = 'notepad.exe';
const MICROSOFT_SUBJECT = /\bCN=Microsoft(?: Corporation)?\b/i;
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

export type ClientArea = { left: number; top: number; right: number; bottom: number };

export type ForegroundSurface = {
    hwnd: string;
    processId: number;
    /** Canonical full protected executable path, never a user-writable basename. */
    executable: string;
    title: string;
    windowsDirectory: string;
    signatureStatus: string;
    signerSubject: string;
    clientArea: ClientArea;
};

export interface ForegroundSurfaceProbe {
    measure(): Promise<ForegroundSurface | null>;
    /** Native Windows integration: recheck the HWND and target input to it in one process. */
    targetedInput?(surface: ForegroundSurface, input: TargetedNativeInput): Promise<void>;
}

const normalizedPath = (value: string) => value.trim().replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase();

const validClientArea = (area: ClientArea | undefined): area is ClientArea => Boolean(
    area && Number.isSafeInteger(area.left) && Number.isSafeInteger(area.top)
    && Number.isSafeInteger(area.right) && Number.isSafeInteger(area.bottom)
    && area.left < area.right && area.top < area.bottom,
);

const canonicalSystemNotepad = (windowsDirectory: string): string =>
    `${normalizedPath(windowsDirectory)}\\system32\\${NOTEPAD_EXECUTABLE}`;

const isMeasuredNotepad = (surface: ForegroundSurface | null): surface is ForegroundSurface => Boolean(
    surface && typeof surface.hwnd === 'string' && surface.hwnd.length > 0
    && Number.isInteger(surface.processId) && surface.processId > 0
    && normalizedPath(surface.executable) === canonicalSystemNotepad(surface.windowsDirectory)
    && surface.signatureStatus === 'Valid'
    && MICROSOFT_SUBJECT.test(surface.signerSubject)
    && validClientArea(surface.clientArea),
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
        return { ...surface, executable: normalizedPath(surface.executable), windowsDirectory: normalizedPath(surface.windowsDirectory) };
    }

    async recheck(token: ForegroundSurface): Promise<void> {
        const current = await this.probe.measure();
        if (!isMeasuredNotepad(current)
            || current.hwnd !== token.hwnd
            || current.processId !== token.processId
            || normalizedPath(current.executable) !== token.executable
            || normalizedPath(current.windowsDirectory) !== token.windowsDirectory
            || current.signatureStatus !== token.signatureStatus
            || current.signerSubject !== token.signerSubject
            || current.clientArea.left !== token.clientArea.left
            || current.clientArea.top !== token.clientArea.top
            || current.clientArea.right !== token.clientArea.right
            || current.clientArea.bottom !== token.clientArea.bottom) {
            throw new Error('Cowork refused: the measured foreground surface drifted or is unavailable.');
        }
    }

    assertClickInBounds(token: ForegroundSurface, x: number, y: number): void {
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
            || x < token.clientArea.left || x >= token.clientArea.right
            || y < token.clientArea.top || y >= token.clientArea.bottom) {
            throw new Error('Cowork refused: click coordinates are outside the measured foreground HWND client area.');
        }
    }

    nativeGuard(token: ForegroundSurface, signal: AbortSignal = NEVER_ABORTED_SIGNAL): NativeActuationGuard {
        const throwIfAborted = () => {
            if (signal.aborted) throw new Error('Cowork cancelled before native actuation quiesced.');
        };
        return {
            signal,
            throwIfAborted,
            recheckAfterNativeAwait: async () => {
                throwIfAborted();
                await this.recheck(token);
                throwIfAborted();
            },
            assertClickInBounds: (x, y) => this.assertClickInBounds(token, x, y),
            targetedInput: async (input) => {
                throwIfAborted();
                this.assertClickInBounds(token, input.x, input.y);
                await this.recheck(token);
                if (!this.probe.targetedInput) throw new Error('Cowork refused: HWND-targeted native input is unavailable.');
                await this.probe.targetedInput(token, input);
                throwIfAborted();
            },
        };
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
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static object Read() {
    IntPtr hwnd = GetForegroundWindow(); if (hwnd == IntPtr.Zero) return null;
    uint pid; GetWindowThreadProcessId(hwnd, out pid); IntPtr process = OpenProcess(0x1000, false, pid); if (process == IntPtr.Zero) return null;
    try { var path = new StringBuilder(32768); uint length = 32768; if (!QueryFullProcessImageName(process, 0, path, ref length)) return null;
      RECT rect; if (!GetClientRect(hwnd, out rect)) return null;
      POINT origin = new POINT { X = rect.Left, Y = rect.Top }; POINT corner = new POINT { X = rect.Right, Y = rect.Bottom };
      if (!ClientToScreen(hwnd, ref origin) || !ClientToScreen(hwnd, ref corner)) return null;
      var title = new StringBuilder(1024); GetWindowText(hwnd, title, title.Capacity);
      return new { hwnd = hwnd.ToInt64().ToString(), processId = pid, executable = path.ToString(), title = title.ToString(),
        left = origin.X, top = origin.Y, right = corner.X, bottom = corner.Y }; }
    finally { CloseHandle(process); }
  }
}
'@
$surface = [SentropicForegroundSurface]::Read()
if ($null -eq $surface) { $null } else {
  $signature = Get-AuthenticodeSignature -LiteralPath $surface.executable
  [pscustomobject]@{ hwnd = $surface.hwnd; processId = $surface.processId; executable = $surface.executable; title = $surface.title;
    windowsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows); signatureStatus = $signature.Status.ToString();
    signerSubject = if ($null -eq $signature.SignerCertificate) { '' } else { $signature.SignerCertificate.Subject };
    clientArea = @{ left = $surface.left; top = $surface.top; right = $surface.right; bottom = $surface.bottom } }
} | ConvertTo-Json -Compress
`;

const WINDOWS_TARGETED_CLICK_SCRIPT = String.raw`
param([string]$ExpectedHwnd, [int]$ExpectedPid, [int]$ScreenX, [int]$ScreenY, [string]$Button)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SentropicTargetedClick {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static bool Click(long hwndValue, int expectedPid, int screenX, int screenY, string button) {
    IntPtr hwnd = new IntPtr(hwndValue); if (GetForegroundWindow() != hwnd) return false;
    uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid != expectedPid) return false;
    RECT rect; if (!GetClientRect(hwnd, out rect)) return false;
    POINT origin = new POINT { X = rect.Left, Y = rect.Top }; POINT corner = new POINT { X = rect.Right, Y = rect.Bottom };
    if (!ClientToScreen(hwnd, ref origin) || !ClientToScreen(hwnd, ref corner) || screenX < origin.X || screenX >= corner.X || screenY < origin.Y || screenY >= corner.Y) return false;
    int x = screenX - origin.X; int y = screenY - origin.Y; IntPtr lParam = new IntPtr((y << 16) | (x & 0xffff));
    uint down = button == "right" ? 0x0204u : button == "middle" ? 0x0207u : 0x0201u;
    uint up = button == "right" ? 0x0205u : button == "middle" ? 0x0208u : 0x0202u;
    SendMessage(hwnd, down, IntPtr.Zero, lParam); SendMessage(hwnd, up, IntPtr.Zero, lParam); return true;
  }
}
'@
if (-not [SentropicTargetedClick]::Click([Int64]$ExpectedHwnd, $ExpectedPid, $ScreenX, $ScreenY, $Button)) { exit 3 }
`;

/** Windows UAT integration: actual signed foreground measurement and HWND-targeted click. */
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
    async targetedInput(surface, input): Promise<void> {
        if (process.platform !== 'win32' || input.kind !== 'click') throw new Error('Cowork refused: HWND-targeted Windows click is unavailable.');
        await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command', WINDOWS_TARGETED_CLICK_SCRIPT,
            surface.hwnd, String(surface.processId), String(input.x), String(input.y), input.button,
        ], { windowsHide: true, timeout: 2_000, maxBuffer: 64 * 1024 });
    },
});
