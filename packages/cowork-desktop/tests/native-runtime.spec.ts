import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    clearNativePayload,
    prepareNativeModules,
    registerNativePayload,
} from '../src/native/native-runtime.js';

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const cacheDir = (): string => mkdtempSync(join(tmpdir(), 'cw-native-'));

/** Build a payload string in the exact format `package-windows.mjs` emits. */
function buildPayload(
    files: { path: string; content: Buffer }[],
    entries: Record<string, string>,
): string {
    const manifest = Buffer.from(JSON.stringify({ entries }));
    const archive = {
        files: [
            ...files.map((f) => ({
                path: f.path,
                sha256: sha(f.content),
                data: f.content.toString('base64'),
            })),
            { path: 'native-manifest.json', sha256: sha(manifest), data: manifest.toString('base64') },
        ],
    };
    return gzipSync(Buffer.from(JSON.stringify(archive))).toString('base64');
}

describe('prepareNativeModules', () => {
    beforeEach(() => clearNativePayload());

    it('returns an identity resolver when no payload is present', async () => {
        const r = await prepareNativeModules({ cacheRoot: cacheDir() });
        expect(r.resolve('@nut-tree-fork/nut-js')).toBe('@nut-tree-fork/nut-js');
    });

    it('extracts the payload and resolves bare specifiers to file:// URLs with intact bytes', async () => {
        const cacheRoot = cacheDir();
        const nut = Buffer.from('NUT-NODE-BYTES');
        const payload = buildPayload(
            [{ path: 'node_modules/@nut-tree-fork/nut-js/dist/index.js', content: nut }],
            { '@nut-tree-fork/nut-js': 'node_modules/@nut-tree-fork/nut-js/dist/index.js' },
        );
        const r = await prepareNativeModules({ cacheRoot, payloadBase64: payload });
        const url = r.resolve('@nut-tree-fork/nut-js');
        expect(url.startsWith('file://')).toBe(true);
        expect(readFileSync(fileURLToPath(url))).toEqual(nut);
        // an unmapped specifier falls back to the bare name
        expect(r.resolve('unmapped')).toBe('unmapped');
    });

    it('is idempotent on a warm cache (reuses the extracted dir)', async () => {
        const cacheRoot = cacheDir();
        const payload = buildPayload(
            [{ path: 'node_modules/x/index.js', content: Buffer.from('X') }],
            { x: 'node_modules/x/index.js' },
        );
        const r1 = await prepareNativeModules({ cacheRoot, payloadBase64: payload });
        const r2 = await prepareNativeModules({ cacheRoot, payloadBase64: payload });
        expect(r1.resolve('x')).toBe(r2.resolve('x'));
        expect(existsSync(fileURLToPath(r2.resolve('x')))).toBe(true);
    });

    it('rejects a tampered payload (sha256 mismatch)', async () => {
        const bad = gzipSync(
            Buffer.from(
                JSON.stringify({
                    files: [
                        {
                            path: 'node_modules/x/index.js',
                            sha256: 'deadbeef',
                            data: Buffer.from('X').toString('base64'),
                        },
                    ],
                }),
            ),
        ).toString('base64');
        await expect(prepareNativeModules({ cacheRoot: cacheDir(), payloadBase64: bad })).rejects.toThrow(
            /integrity/,
        );
    });

    it('honors a payload set via registerNativePayload', async () => {
        const payload = buildPayload(
            [{ path: 'node_modules/x/index.js', content: Buffer.from('X') }],
            { x: 'node_modules/x/index.js' },
        );
        registerNativePayload(payload);
        const r = await prepareNativeModules({ cacheRoot: cacheDir() });
        expect(r.resolve('x').startsWith('file://')).toBe(true);
    });
});
