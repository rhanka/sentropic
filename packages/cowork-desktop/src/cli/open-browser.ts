/**
 * Best-effort, shell-safe default-browser opener.
 *
 * Uses `spawn` with an argv array (NO shell string interpolation of the URL),
 * detached + unref'd so it never blocks the CLI. Returns false on any failure;
 * callers MUST always print a copy-paste URL fallback (we don't assume an
 * interactive desktop).
 */

import { spawn } from 'node:child_process';

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): boolean {
    try {
        let command: string;
        let args: string[];
        if (platform === 'win32') {
            // `start` is a cmd builtin; first quoted arg is the window title ("").
            command = 'cmd';
            args = ['/c', 'start', '', url];
        } else if (platform === 'darwin') {
            command = 'open';
            args = [url];
        } else {
            command = 'xdg-open';
            args = [url];
        }
        const child = spawn(command, args, { stdio: 'ignore', detached: true });
        child.on('error', () => {});
        child.unref();
        return true;
    } catch {
        return false;
    }
}
