/**
 * Build the signable single Windows .exe for @sentropic/cowork-desktop.
 *
 * Runs entirely on Linux/Docker. Steps:
 *   1. Fetch the Windows native prebuilds on Linux via `npm install --os=win32
 *      --cpu=x64` into a staging dir.
 *   2. Prune to win32-x64 (drop other-OS libnut builds + sourcemaps/d.ts).
 *   3. Embed the pruned native tree as a gzip+base64 *payload module*
 *      (`build/native-payload.generated.mjs`) — a single string bundled into the
 *      exe (NOT pkg assets). At first run the binary extracts it to a real cache
 *      and resolves the native `.node`/DLLs from there (see `native-runtime.ts`).
 *   4. esbuild bundle of the packaging entry (which imports + registers the
 *      payload) -> one CJS file.
 *   5. @yao-pkg/pkg cross-compile the bundle to win-x64 -> a single cowork.exe.
 *   6. Authenticode sign with osslsigncode IF a cert is provided; else skip.
 *
 * Output (gitignored, mirrors the chrome-ext location):
 *   ui/static/cowork-desktop/cowork.exe
 *   ui/static/cowork-desktop/cowork-desktop-metadata.json
 * (No zip: the exe is self-contained — the native payload is embedded.)
 *
 * Runs inside the packaging Docker image (node, @yao-pkg/pkg, osslsigncode), repo
 * mounted at /workspace so the cowork-bridge / chat-ui symlinks resolve.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const buildDir = path.join(packageRoot, 'build');
const nativeStageDir = path.join(buildDir, 'native');
const payloadPath = path.join(buildDir, 'native-payload.generated.mjs');
const outDir = path.join(repoRoot, 'ui', 'static', 'cowork-desktop');

const bundlePath = path.join(buildDir, 'cowork.bundle.cjs');
const exeName = 'cowork.exe';
const exePath = path.join(buildDir, exeName);
const staleZipName = 'sentropic-cowork-windows-x64.zip';

// Windows native prebuilds embedded into the exe (extracted + loaded at runtime).
const NATIVE_MODULES = [
    { name: 'screenshot-desktop', version: '^1.15.0' },
    { name: '@nut-tree-fork/nut-js', version: '^4.2.0' },
];
const TIMESTAMP_URL = process.env.COWORK_SIGN_TS_URL ?? 'http://timestamp.digicert.com';

const log = (msg) => process.stdout.write(`${msg}\n`);
const warn = (msg) => process.stderr.write(`⚠️  ${msg}\n`);
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');
const toPosix = (p) => p.split(path.sep).join('/');

const run = (cmd, args, opts = {}) => {
    const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
    if (res.error) {
        if (res.error.code === 'ENOENT') {
            throw new Error(`command not found: ${cmd}. Install it in the packaging image.`);
        }
        throw res.error;
    }
    if (res.status !== 0) {
        throw new Error(`${cmd} ${args.join(' ')} failed with status ${res.status ?? 'unknown'}.`);
    }
};

const readPackageVersion = () =>
    JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;

const collectFiles = (root) => {
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) out.push(full);
        }
    };
    walk(root);
    return out;
};

// --- Step 1: fetch Windows native prebuilds (on Linux) ----------------------

const fetchNativePrebuilds = () => {
    log('▶ npm: fetching Windows (win32/x64) native prebuilds…');
    fs.rmSync(nativeStageDir, { recursive: true, force: true });
    fs.mkdirSync(nativeStageDir, { recursive: true });
    fs.writeFileSync(
        path.join(nativeStageDir, 'package.json'),
        JSON.stringify(
            {
                name: 'cowork-native-stage',
                private: true,
                version: '0.0.0',
                dependencies: Object.fromEntries(NATIVE_MODULES.map((m) => [m.name, m.version])),
            },
            null,
            2,
        ),
    );
    run(
        'npm',
        ['install', '--os=win32', '--cpu=x64', '--no-audit', '--no-fund', '--no-save', '--ignore-scripts'],
        { cwd: nativeStageDir, env: { ...process.env, npm_config_cache: '/tmp/npm-cache' } },
    );
    const installedRoot = path.join(nativeStageDir, 'node_modules');
    if (!fs.existsSync(installedRoot)) {
        throw new Error('npm did not install the native modules for win32/x64. STOP (missing prebuild).');
    }
    return installedRoot;
};

// --- Step 2: prune to win32-x64 ---------------------------------------------

const pruneNative = (installedRoot) => {
    // Drop non-win32 libnut platform builds (large, never loaded on Windows).
    const nutScope = path.join(installedRoot, '@nut-tree-fork');
    if (fs.existsSync(nutScope)) {
        for (const dir of fs.readdirSync(nutScope)) {
            if (/^libnut-/.test(dir) && dir !== 'libnut-win32') {
                fs.rmSync(path.join(nutScope, dir), { recursive: true, force: true });
            }
        }
    }
    // Drop runtime-irrelevant files everywhere.
    let dropped = 0;
    for (const file of collectFiles(installedRoot)) {
        if (file.endsWith('.map') || file.endsWith('.d.ts')) {
            fs.rmSync(file, { force: true });
            dropped++;
        }
    }
    log(`  ✅ pruned non-win32 libnut builds + ${dropped} sourcemap/d.ts files.`);
};

// --- Step 3: embed the native tree as a gzip+base64 payload module -----------

const resolveEntry = (installedRoot, name) => {
    const pkgDir = path.join(installedRoot, ...name.split('/'));
    let main = 'index.js';
    try {
        const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
        if (typeof pj.main === 'string' && pj.main.trim()) main = pj.main.trim();
    } catch {
        /* default index.js */
    }
    return path.posix.join('node_modules', ...name.split('/'), ...main.split(/[\\/]/));
};

const generatePayload = (installedRoot) => {
    log('▶ embedding native payload (gzip+base64)…');
    const entries = Object.fromEntries(NATIVE_MODULES.map((m) => [m.name, resolveEntry(installedRoot, m.name)]));
    const files = collectFiles(installedRoot).map((full) => {
        const bytes = fs.readFileSync(full);
        return {
            path: path.posix.join('node_modules', toPosix(path.relative(installedRoot, full))),
            sha256: sha256Hex(bytes),
            data: bytes.toString('base64'),
        };
    });
    const manifest = Buffer.from(JSON.stringify({ entries }));
    files.push({ path: 'native-manifest.json', sha256: sha256Hex(manifest), data: manifest.toString('base64') });

    const payloadB64 = zlib.gzipSync(Buffer.from(JSON.stringify({ files }))).toString('base64');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(
        payloadPath,
        `// generated by package-windows.mjs — do not edit, do not commit.\nexport default ${JSON.stringify(payloadB64)};\n`,
    );
    log(`  ✅ payload embedded (${files.length} files, ${(payloadB64.length / (1024 * 1024)).toFixed(1)} MB base64).`);
};

// --- Step 4: esbuild bundle (entry imports the payload) ---------------------

const bundle = async () => {
    log('▶ esbuild: bundling single CJS entry…');
    fs.mkdirSync(buildDir, { recursive: true });
    await import('./esbuild.config.mjs');
    if (!fs.existsSync(bundlePath)) {
        throw new Error(`esbuild did not produce the bundle: ${bundlePath}`);
    }
};

// --- Step 5: pkg cross-compile to win-x64 -----------------------------------

const packExe = () => {
    log('▶ pkg (@yao-pkg/pkg): cross-compiling bundle -> win-x64 cowork.exe…');
    run('pkg', [bundlePath, '--targets', 'node24-win-x64', '--output', exePath, '--public']);
    if (!fs.existsSync(exePath)) {
        throw new Error('pkg did not produce cowork.exe. Single-exe packaging FAILED — STOP and report.');
    }
    log(`  ✅ ${exeName} produced (${(fs.statSync(exePath).size / (1024 * 1024)).toFixed(1)} MB).`);
};

// --- Step 6: optional Authenticode signing ----------------------------------

const signExe = () => {
    const pfx = (process.env.COWORK_SIGN_PFX ?? '').trim();
    if (!pfx) {
        warn(
            'cowork.exe is UNSIGNED (no cert). Set COWORK_SIGN_PFX (OV .pfx) + COWORK_SIGN_PASS to sign. ' +
                'SmartScreen/AV will warn on an unsigned binary.',
        );
        return false;
    }
    if (!fs.existsSync(pfx)) throw new Error(`COWORK_SIGN_PFX points to a missing file: ${pfx}`);
    log('▶ osslsigncode: Authenticode-signing cowork.exe…');
    const signedPath = `${exePath}.signed`;
    run('osslsigncode', [
        'sign', '-pkcs12', pfx, '-pass', process.env.COWORK_SIGN_PASS ?? '',
        '-n', 'Sentropic Cowork', '-i', 'https://sentropic.app', '-t', TIMESTAMP_URL,
        '-in', exePath, '-out', signedPath,
    ]);
    fs.rmSync(exePath, { force: true });
    fs.renameSync(signedPath, exePath);
    log('  ✅ cowork.exe signed.');
    return true;
};

// --- Step 7: publish the single exe + metadata ------------------------------

const output = (signed, version) => {
    fs.mkdirSync(outDir, { recursive: true });
    const exeOut = path.join(outDir, exeName);
    fs.rmSync(exeOut, { force: true });
    fs.copyFileSync(exePath, exeOut);
    // Remove any stale folder-zip from a previous build of this artifact dir.
    fs.rmSync(path.join(outDir, staleZipName), { force: true });
    fs.writeFileSync(
        path.join(outDir, 'cowork-desktop-metadata.json'),
        `${JSON.stringify({ version, source: 'packages/cowork-desktop', platform: 'win32-x64', signed, exe: exeName }, null, 2)}\n`,
    );
    log(`  ✅ exe -> ${exeOut} (single file, no zip)`);
};

// --- Orchestration ----------------------------------------------------------

const main = async () => {
    const version = readPackageVersion();
    log(`Packaging @sentropic/cowork-desktop@${version} -> single Windows .exe\n`);

    const installedRoot = fetchNativePrebuilds();
    pruneNative(installedRoot);
    generatePayload(installedRoot);
    await bundle();
    packExe();
    const signed = signExe();
    output(signed, version);

    log('\n✅ Windows packaging complete.');
    if (!signed) log('   (artifact is UNSIGNED — provide COWORK_SIGN_PFX + COWORK_SIGN_PASS to sign.)');
};

main().catch((error) => {
    process.stderr.write(`\n❌ packaging failed: ${error?.message ?? error}\n`);
    process.exitCode = 1;
});
