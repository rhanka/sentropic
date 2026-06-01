/**
 * Build the signable single Windows .exe for @sentropic/cowork-desktop.
 *
 * Runs entirely on Linux/Docker (BR41a-Q2/BR41-Q1). Steps:
 *   1. esbuild bundle of the binary entry -> one CJS file (native libs external).
 *   2. @yao-pkg/pkg cross-compile the bundle to win-x64 -> cowork.exe.
 *      (the maintained pkg fork; cross-compiles from Linux and embeds Node 24.)
 *   3. Fetch the Windows native prebuilds while on Linux via
 *      `npm install --os=win32 --cpu=x64 ...` into a staging dir and ship the
 *      resulting modules next to the exe so the runtime dynamic import resolves.
 *   4. Authenticode sign with osslsigncode IF a cert is provided
 *      (COWORK_SIGN_PFX + COWORK_SIGN_PASS); otherwise skip with a warning.
 *   5. Stage exe + native modules + launcher into the download location and zip.
 *
 * Output (mirrors the chrome-ext zip location, gitignored):
 *   ui/static/cowork-desktop/cowork.exe
 *   ui/static/cowork-desktop/sentropic-cowork-windows-x64.zip
 *   ui/static/cowork-desktop/cowork-desktop-metadata.json
 *
 * This script is expected to run inside the packaging Docker image, with node,
 * @yao-pkg/pkg, osslsigncode and zip available, and the repo mounted at
 * /workspace (so the cowork-bridge / chat-ui symlinks resolve).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const buildDir = path.join(packageRoot, 'build');
const stagingDir = path.join(buildDir, 'staging');
const nativeStageDir = path.join(buildDir, 'native');
const outDir = path.join(repoRoot, 'ui', 'static', 'cowork-desktop');

const bundlePath = path.join(buildDir, 'cowork.bundle.cjs');
const exeName = 'cowork.exe';
const exePath = path.join(buildDir, exeName);
const zipName = 'sentropic-cowork-windows-x64.zip';
const zipRootDirectory = 'sentropic-cowork-windows-x64';

// Windows native prebuilds shipped next to the exe (loaded at runtime).
const NATIVE_MODULES = [
    { name: 'screenshot-desktop', version: '^1.15.0' },
    { name: '@nut-tree-fork/nut-js', version: '^4.2.0' },
];
const TIMESTAMP_URL = process.env.COWORK_SIGN_TS_URL ?? 'http://timestamp.digicert.com';

const log = (msg) => process.stdout.write(`${msg}\n`);
const warn = (msg) => process.stderr.write(`⚠️  ${msg}\n`);

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

// --- Step 1: esbuild bundle -------------------------------------------------

const bundle = async () => {
    log('▶ esbuild: bundling single CJS entry…');
    fs.mkdirSync(buildDir, { recursive: true });
    await import('./esbuild.config.mjs');
    if (!fs.existsSync(bundlePath)) {
        throw new Error(`esbuild did not produce the bundle: ${bundlePath}`);
    }
};

// --- Step 2: pkg cross-compile to win-x64 -----------------------------------

const packExe = () => {
    log('▶ pkg (@yao-pkg/pkg): cross-compiling bundle -> win-x64 cowork.exe…');
    // The pkg fork CLI is installed globally in the image (`pkg` on PATH) OR run
    // via npx. We target Node 24 / win-x64 and emit a single exe.
    run('pkg', [
        bundlePath,
        '--targets',
        'node24-win-x64',
        '--output',
        exePath,
        '--public',
    ]);
    if (!fs.existsSync(exePath)) {
        throw new Error(
            `pkg did not produce ${exePath}. Single-exe packaging FAILED — STOP and report ` +
                '(do NOT silently fall back to folder-zip; the user chose a single signable exe).',
        );
    }
    const sizeMb = (fs.statSync(exePath).size / (1024 * 1024)).toFixed(1);
    log(`  ✅ ${exeName} produced (${sizeMb} MB).`);
};

// --- Step 3: fetch Windows native prebuilds (on Linux) ----------------------

const fetchNativePrebuilds = () => {
    log('▶ npm: fetching Windows (win32/x64) native prebuilds for the optional libs…');
    fs.rmSync(nativeStageDir, { recursive: true, force: true });
    fs.mkdirSync(nativeStageDir, { recursive: true });

    // A throwaway package.json so npm installs into nativeStageDir/node_modules.
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

    // npm 10+ honours --os/--cpu to force the *target* platform optional binaries
    // (prebuilt .node / win DLLs) even when running on Linux.
    run(
        'npm',
        [
            'install',
            '--os=win32',
            '--cpu=x64',
            '--no-audit',
            '--no-fund',
            '--no-save',
            '--ignore-scripts',
        ],
        { cwd: nativeStageDir, env: { ...process.env, npm_config_cache: '/tmp/npm-cache' } },
    );

    const installedRoot = path.join(nativeStageDir, 'node_modules');
    if (!fs.existsSync(installedRoot)) {
        throw new Error(
            'npm did not install the native modules for win32/x64. Single-exe native shipping ' +
                'FAILED — STOP and report (missing prebuild).',
        );
    }
    return installedRoot;
};

// --- Step 4: optional Authenticode signing ----------------------------------

const signExe = () => {
    const pfx = (process.env.COWORK_SIGN_PFX ?? '').trim();
    if (!pfx) {
        warn(
            'cowork.exe is UNSIGNED (no cert provided). Set COWORK_SIGN_PFX (path to an OV .pfx) ' +
                'and COWORK_SIGN_PASS to enable Authenticode signing. SmartScreen/AV will warn on an ' +
                'unsigned binary.',
        );
        return false;
    }
    if (!fs.existsSync(pfx)) {
        throw new Error(`COWORK_SIGN_PFX points to a missing file: ${pfx}`);
    }
    const pass = process.env.COWORK_SIGN_PASS ?? '';
    log('▶ osslsigncode: Authenticode-signing cowork.exe…');
    const signedPath = `${exePath}.signed`;
    run('osslsigncode', [
        'sign',
        '-pkcs12',
        pfx,
        '-pass',
        pass,
        '-n',
        'Sentropic Cowork',
        '-i',
        'https://sentropic.app',
        '-t',
        TIMESTAMP_URL,
        '-in',
        exePath,
        '-out',
        signedPath,
    ]);
    fs.rmSync(exePath, { force: true });
    fs.renameSync(signedPath, exePath);
    log('  ✅ cowork.exe signed.');
    return true;
};

// --- Step 5: stage + zip + metadata -----------------------------------------

const stageAndZip = (nativeRoot, signed, version) => {
    log('▶ staging exe + native modules + launcher and zipping…');
    fs.rmSync(stagingDir, { recursive: true, force: true });
    const stageRoot = path.join(stagingDir, zipRootDirectory);
    fs.mkdirSync(stageRoot, { recursive: true });

    // The exe.
    fs.copyFileSync(exePath, path.join(stageRoot, exeName));

    // The native modules go under node_modules/ next to the exe so the runtime
    // dynamic import('screenshot-desktop') / import('@nut-tree-fork/nut-js')
    // resolves relative to process.cwd()/exe dir.
    const stageNodeModules = path.join(stageRoot, 'node_modules');
    fs.cpSync(nativeRoot, stageNodeModules, { recursive: true });

    // A tiny launcher .cmd so users can double-click; sets the API base if unset.
    fs.writeFileSync(
        path.join(stageRoot, 'Start Sentropic Cowork.cmd'),
        [
            '@echo off',
            'REM Launch the Sentropic Cowork desktop companion.',
            'REM Set SENTROPIC_API_BASE_URL to your Sentropic API base, e.g.:',
            'REM   set SENTROPIC_API_BASE_URL=https://api.sentropic.app/api/v1',
            'cowork.exe %*',
            'pause',
            '',
        ].join('\r\n'),
    );

    fs.mkdirSync(outDir, { recursive: true });
    const exeOut = path.join(outDir, exeName);
    fs.rmSync(exeOut, { force: true });
    fs.copyFileSync(exePath, exeOut);

    const zipOut = path.join(outDir, zipName);
    fs.rmSync(zipOut, { force: true });
    run('zip', ['-rq', zipOut, zipRootDirectory], { cwd: stagingDir });

    // Metadata mirroring the chrome-ext extension-metadata.json.
    fs.writeFileSync(
        path.join(outDir, 'cowork-desktop-metadata.json'),
        `${JSON.stringify(
            {
                version,
                source: 'packages/cowork-desktop',
                platform: 'win32-x64',
                signed,
                exe: exeName,
                zip: zipName,
            },
            null,
            2,
        )}\n`,
    );

    log(`  ✅ exe  -> ${exeOut}`);
    log(`  ✅ zip  -> ${zipOut}`);
};

// --- Orchestration ----------------------------------------------------------

const main = async () => {
    const version = readPackageVersion();
    log(`Packaging @sentropic/cowork-desktop@${version} -> single Windows .exe\n`);

    await bundle();
    packExe();
    const nativeRoot = fetchNativePrebuilds();
    const signed = signExe();
    stageAndZip(nativeRoot, signed, version);

    log('\n✅ Windows packaging complete.');
    if (!signed) {
        log('   (artifact is UNSIGNED — provide COWORK_SIGN_PFX + COWORK_SIGN_PASS to sign.)');
    }
};

main().catch((error) => {
    process.stderr.write(`\n❌ packaging failed: ${error?.message ?? error}\n`);
    process.exitCode = 1;
});
