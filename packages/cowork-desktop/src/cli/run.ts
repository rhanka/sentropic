/**
 * Shared CLI lifecycle for the Sentropic Cowork binary.
 *
 * Both entrypoints call `runCli()` so the two thin wrappers cannot drift:
 *  - `bin/cowork.mjs`     imports it from the built `../dist/index.js`
 *  - `packaging/entry.mjs` imports it from `../src/index.ts` (esbuild-bundled)
 *
 * Lifecycle: resolve API base -> enroll (device-code) -> register presence.
 * (The SSE consume loop that lets the agent drive the tools is a separate
 * backend branch — see spec/SPEC_COWORK_41B_FIXES.md "Deferred to a dedicated
 * branch".)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

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
import { createToolResultsPoster, CoworkRunner } from '../runner/index.js';
import { resolveCoworkAccessToken } from './auth-bootstrap.js';

const APP_DIR = process.env.SENTROPIC_COWORK_DIR ?? join(homedir(), '.sentropic', 'cowork');
const DEVICE_NAME = process.env.SENTROPIC_DEVICE_NAME ?? 'Sentropic Cowork';

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

    const consent = new ConsentManager({ store });
    const postToolResults = createToolResultsPoster({
        fetch: globalThis.fetch,
        apiBaseUrl,
        getAccessToken,
    });
    // The runner is ready; the SSE consume loop is a separate backend branch.
    new CoworkRunner({ consent, context: { provider }, postToolResults });

    const shutdown = async () => {
        await registry.unregister().catch(() => {});
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.stdout.write('Cowork is running. Press Ctrl+C to disconnect.\n');
}
