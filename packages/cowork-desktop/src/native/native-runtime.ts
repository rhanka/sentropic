/**
 * Native module runtime for the single-file Windows .exe.
 *
 * The win32 native deps (`@nut-tree-fork/nut-js` + `libnut.node` + its sidecar
 * MSVC DLLs, and `screenshot-desktop`) cannot be `dlopen`'d from inside the pkg
 * snapshot, so they are embedded as a single gzip+base64 *payload string* in the
 * bundle (NOT pkg `assets` — that avoids the snapshot-fs read entirely; the
 * string lives in memory). On first run we extract the payload to a real on-disk
 * cache keyed by the payload hash (so an ABI change → a new cache dir for free),
 * then resolve each bare specifier to an absolute `file://` URL UNDER a real
 * `node_modules` so `bindings`' walk-up succeeds.
 *
 * When the binary runs from `npm` (dist build) the optionalDependencies are real
 * `node_modules` on disk and no payload is registered → identity resolver.
 *
 * The extraction/resolution logic here is platform-agnostic and unit-tested on
 * Linux with the linux libnut build; only the final `dlopen` is Windows-only
 * (validated at UAT).
 */

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A native module resolver: bare specifier -> import target (bare name or file:// URL). */
export interface NativeResolver {
    resolve(bareSpecifier: string): string;
}

interface NativeArchiveFile {
    /** POSIX-style relative path under the cache dir (e.g. `node_modules/...`). */
    path: string;
    /** hex sha256 of the raw bytes. */
    sha256: string;
    /** base64 of the raw bytes. */
    data: string;
}

interface NativeArchive {
    files: NativeArchiveFile[];
}

/** Written into the cache dir (part of the archive); maps specifier -> entry path. */
interface NativeManifest {
    entries: Record<string, string>;
}

const MANIFEST_NAME = 'native-manifest.json';
const IDENTITY: NativeResolver = { resolve: (s) => s };

let registeredPayload: string | null = null;

/** Called by the packaging entry (only present in the bundled exe). */
export function registerNativePayload(payloadBase64: string): void {
    registeredPayload = payloadBase64;
}

/** Test seam / explicit reset. */
export function clearNativePayload(): void {
    registeredPayload = null;
}

const sha256Hex = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

const decodeArchive = (payloadBase64: string): NativeArchive =>
    JSON.parse(gunzipSync(Buffer.from(payloadBase64, 'base64')).toString('utf8')) as NativeArchive;

/**
 * Extract into a unique temp dir, then atomically rename into place ONLY if the
 * target does not exist (lose-the-race -> discard our temp; never rename over an
 * existing dir — Windows rename fails EPERM/ENOTEMPTY).
 */
const extractAtomically = (archive: NativeArchive, finalDir: string, nativeRoot: string): void => {
    mkdirSync(nativeRoot, { recursive: true });
    const tmp = mkdtempSync(join(nativeRoot, '.tmp-'));
    try {
        for (const file of archive.files) {
            const bytes = Buffer.from(file.data, 'base64');
            if (sha256Hex(bytes) !== file.sha256) {
                throw new Error(`native payload integrity check failed for ${file.path}`);
            }
            const dest = join(tmp, file.path);
            mkdirSync(dirname(dest), { recursive: true });
            writeFileSync(dest, bytes);
        }
        if (!existsSync(finalDir)) {
            renameSync(tmp, finalDir);
            return;
        }
    } finally {
        // If the rename succeeded, tmp is gone; force-cleanup is safe either way.
        rmSync(tmp, { recursive: true, force: true });
    }
};

/**
 * Prepare native modules and return a resolver.
 * - No payload -> identity (bare specifiers resolve from node_modules).
 * - Payload -> extract once to `${cacheRoot}/native/<payloadHash>/` (atomic,
 *   hash-verified) and resolve bare specifiers to absolute file:// URLs.
 */
export async function prepareNativeModules(opts: {
    cacheRoot: string;
    payloadBase64?: string | null;
}): Promise<NativeResolver> {
    const payload = opts.payloadBase64 ?? registeredPayload;
    if (!payload) return IDENTITY;

    const hash = sha256Hex(payload).slice(0, 16);
    const nativeRoot = join(opts.cacheRoot, 'native');
    const finalDir = join(nativeRoot, hash);

    if (!existsSync(join(finalDir, MANIFEST_NAME))) {
        extractAtomically(decodeArchive(payload), finalDir, nativeRoot);
    }

    const manifest = JSON.parse(readFileSync(join(finalDir, MANIFEST_NAME), 'utf8')) as NativeManifest;
    const entries = manifest.entries ?? {};

    return {
        resolve(bareSpecifier: string): string {
            const rel = entries[bareSpecifier];
            return rel ? pathToFileURL(join(finalDir, rel)).href : bareSpecifier;
        },
    };
}
