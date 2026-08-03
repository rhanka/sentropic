/**
 * Shared CLI lifecycle for the Sentropic Cowork binary.
 *
 * Both entrypoints call `runCli()` so the two thin wrappers cannot drift:
 *  - `bin/cowork.mjs`     imports it from the built `../dist/index.js`
 *  - `packaging/entry.mjs` imports it from `../src/index.ts` (esbuild-bundled)
 *
 * Lifecycle: resolve API base -> enroll (device-code) -> register presence ->
 * device-proof lease delivery. The console foreground prompt is the thin UAT
 * host for the native/WebView2 shell; the cross-platform lease logic lives in
 * `remote/` and remains unit-testable without that shell.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { resolveApiBaseUrl } from '../config/api-base-url.js';
import { buildPairingUrl } from '../config/app-origin.js';
import { openBrowser } from './open-browser.js';
import { createFileStore } from '../storage/index.js';
import { createWindowsCapabilityProvider } from '../capability/index.js';
import { prepareNativeModules } from '../native/index.js';
import { DeviceCodeClient, loadOrCreateDeviceIdentity } from '../enroll/index.js';
import { SessionAuthClient } from '@sentropic/cowork-bridge/auth';
import { RegistryClient } from '../registry/index.js';
import { ConsentManager } from '../consent/index.js';
import { RemoteLeaseRunner } from '../remote/index.js';
import { resolveCoworkAccessToken } from './auth-bootstrap.js';

const APP_DIR = process.env.SENTROPIC_COWORK_DIR ?? join(homedir(), '.sentropic', 'cowork');
const DEVICE_NAME = process.env.SENTROPIC_DEVICE_NAME ?? 'Sentropic Cowork';
const ISOLATED_VM = process.env.SENTROPIC_COWORK_ISOLATED_VM === 'true';
const KIOSK_SURFACE = process.env.SENTROPIC_COWORK_KIOSK_SURFACE?.trim();

const promptAllowOnce = async (request: { toolName: string; details?: Record<string, unknown> }) => {
    const terminal = createInterface({ input: process.stdin as never, output: process.stdout as never });
    try {
        const answer = await terminal.question(`Remote Cowork requests ${request.toolName} ${JSON.stringify(request.details ?? {})}. Allow once? [y/N] `);
        return answer.trim().toLowerCase() === 'y' ? 'allow_once' as const : 'deny_once' as const;
    } finally { terminal.close(); }
};

function usage(apiBaseUrl: string): void {
    process.stdout.write(
        [
            'Sentropic Cowork — desktop companion (eyes + hands).',
            '',
            'Environment:',
            `  SENTROPIC_API_BASE_URL   API base (default: ${apiBaseUrl})`,
            '  SENTROPIC_APP_ORIGIN     web app origin for pairing (default: derived from the API base)',
            '  SENTROPIC_COWORK_DIR     app data dir (default: ~/.sentropic/cowork)',
            '  SENTROPIC_DEVICE_NAME    device name shown in the chat target selector',
            '  SENTROPIC_COWORK_ISOLATED_VM=true and SENTROPIC_COWORK_KIOSK_SURFACE=notepad for the only executable MVP target',
            '',
            'Flags:',
            '  --no-open                do not auto-open the browser for pairing',
            '',
            'On first launch it requests a device code, prints PAIR-XXXX + the pairing URL',
            '(and opens it in your browser), then polls until you approve the device in the',
            'Sentropic web app. After enrollment it registers in the presence registry.',
            '',
        ].join('\n'),
    );
}

export async function runCli(): Promise<void> {
    const apiBaseUrl = resolveApiBaseUrl();

    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        usage(apiBaseUrl);
        return;
    }

    const store = createFileStore(APP_DIR);
    if (ISOLATED_VM && !KIOSK_SURFACE) {
        process.stderr.write('SENTROPIC_COWORK_KIOSK_SURFACE is required for an isolated VM target.\n');
        process.exitCode = 1;
        return;
    }
    const deviceIdentity = await loadOrCreateDeviceIdentity(store);
    // In the single-file exe the native deps are extracted from the embedded
    // payload to a cache and resolved by absolute file:// URL; from npm they
    // resolve from node_modules (identity).
    const nativeResolver = await prepareNativeModules({ cacheRoot: APP_DIR });
    const provider = createWindowsCapabilityProvider({
        resolveNativeModule: (name) => nativeResolver.resolve(name),
    });

    const auth = new SessionAuthClient({
        storage: store,
        fetch: globalThis.fetch,
        config: { apiBaseUrl },
    });
    const enroller = new DeviceCodeClient({
        fetch: globalThis.fetch,
        storage: store,
        apiBaseUrl,
        deviceName: DEVICE_NAME,
        deviceIdentity,
        capabilities: {
            capabilityIds: ['screen_capture', 'input_action'],
            isolatedVmTarget: ISOLATED_VM,
            ...(KIOSK_SURFACE ? { kioskSurface: KIOSK_SURFACE } : {}),
        },
    });

    const noOpen = process.argv.includes('--no-open');
    try {
        const authResult = await resolveCoworkAccessToken({
            auth,
            deviceCode: enroller,
            onDeviceCode: (start) => {
            // Build a full, clickable pairing URL ourselves — the server's
            // `verification_uri` is host-less for headless callers, so we ignore it.
            const pairingUrl = buildPairingUrl(start.userCode);
            process.stdout.write(
                '\n  Pair this device — open this URL in the browser where you are logged in:\n' +
                    `    ${pairingUrl}\n` +
                    `  (verification code: ${start.userCode})\n\n`,
            );
            if (!noOpen && openBrowser(pairingUrl)) {
                process.stdout.write('  Opening your browser…\n\n');
            }
            },
        });
        if (authResult.source === 'device-code') process.stdout.write('Enrolled Cowork with device code.\n');
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'enrollment failed'}\n`);
        process.exitCode = 1;
        return;
    }

    const getAccessToken = async () => auth.getValidAccessToken();

    const registry = new RegistryClient({
        fetch: globalThis.fetch,
        apiBaseUrl,
        getAccessToken,
        deviceName: DEVICE_NAME,
        deviceId: deviceIdentity.deviceId,
    });
    await registry.register();
    process.stdout.write(`Registered device ${registry.registeredTabId}.\n`);

    const consent = new ConsentManager({ store, prompt: promptAllowOnce });
    const remoteRunner = new RemoteLeaseRunner({
        fetch: globalThis.fetch, apiBaseUrl, getAccessToken, deviceIdentity, consent, context: { provider },
    });
    let running = true;
    void (async () => {
        while (running) {
            await remoteRunner.connectSse().catch(() => {});
            await remoteRunner.poll().catch(() => {});
            if (running) await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
    })();

    const shutdown = async () => {
        running = false;
        await remoteRunner.stop().catch(() => {});
        await registry.unregister().catch(() => {});
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.stdout.write('Cowork is running. Press Ctrl+C to disconnect.\n');
}
