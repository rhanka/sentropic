#!/usr/bin/env node
/**
 * Thin Sentropic Cowork binary entry.
 *
 * Wires the library lifecycle: enroll (device-code) → register (desktop_cowork)
 * → consume the chat SSE stream → on tool_call: consent-gate → execute via the
 * Windows capability provider → post tool-results.
 *
 * This wrapper is intentionally minimal in Lot 4 (Linux-buildable + mock-
 * testable). The SSE consumption loop and tray UI are completed at packaging
 * (Lot 5); the importable library (`../src/index.ts`, built to `../dist`) holds
 * all testable logic. Run with `--help` for usage.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

const API_BASE_URL = process.env.SENTROPIC_API_BASE_URL ?? '';
const APP_DIR = process.env.SENTROPIC_COWORK_DIR ?? join(homedir(), '.sentropic', 'cowork');
const DEVICE_NAME = process.env.SENTROPIC_DEVICE_NAME ?? 'Sentropic Cowork';

const usage = () => {
    process.stdout.write(
        [
            'Sentropic Cowork — desktop companion (eyes + hands).',
            '',
            'Environment:',
            '  SENTROPIC_API_BASE_URL   API base, e.g. https://api.sentropic.app/api/v1 (required)',
            '  SENTROPIC_COWORK_DIR     app data dir (default: ~/.sentropic/cowork)',
            '  SENTROPIC_DEVICE_NAME    device name shown in the chat target selector',
            '',
            'On first launch it requests a device code, prints PAIR-XXXX + a verification URL,',
            'and polls until you approve the device in the Sentropic web app. After enrollment it',
            'registers in the presence registry and serves screen_capture / input_action tools',
            '(default-deny consent) driven from the chat.',
            '',
        ].join('\n'),
    );
};

async function main() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        usage();
        return;
    }
    if (!API_BASE_URL) {
        process.stderr.write('error: SENTROPIC_API_BASE_URL is required.\n\n');
        usage();
        process.exitCode = 1;
        return;
    }

    // The built library lives at ../dist (produced by `tsc -p tsconfig.json`).
    const lib = await import('../dist/index.js');
    const {
        createFileStore,
        createWindowsCapabilityProvider,
        DeviceCodeClient,
        RegistryClient,
        ConsentManager,
        createToolResultsPoster,
        CoworkRunner,
    } = lib;

    const store = createFileStore(APP_DIR);
    const provider = createWindowsCapabilityProvider();

    const enroller = new DeviceCodeClient({
        fetch: globalThis.fetch,
        storage: store,
        apiBaseUrl: API_BASE_URL,
        deviceName: DEVICE_NAME,
    });

    const existing = await store.readSession();
    if (!existing) {
        const outcome = await enroller.enroll((start) => {
            process.stdout.write(
                `\nPair this device: open ${start.verificationUri}\n` +
                    `and enter code: ${start.userCode}\n\n`,
            );
        });
        if (outcome.status !== 'approved') {
            process.stderr.write(`enrollment failed: ${outcome.status}\n`);
            process.exitCode = 1;
            return;
        }
        process.stdout.write(`Enrolled as ${outcome.user.email ?? outcome.user.id}.\n`);
    }

    const getAccessToken = async () => (await store.readSession())?.sessionToken ?? null;

    const registry = new RegistryClient({
        fetch: globalThis.fetch,
        apiBaseUrl: API_BASE_URL,
        getAccessToken,
        deviceName: DEVICE_NAME,
    });
    await registry.register();
    process.stdout.write(`Registered device ${registry.registeredTabId}.\n`);

    const consent = new ConsentManager({ store });
    const postToolResults = createToolResultsPoster({
        fetch: globalThis.fetch,
        apiBaseUrl: API_BASE_URL,
        getAccessToken,
    });
    // The runner is ready; SSE consumption is wired at packaging (Lot 5).
    new CoworkRunner({ consent, context: { provider }, postToolResults });

    const shutdown = async () => {
        await registry.unregister().catch(() => {});
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.stdout.write('Cowork is running. Press Ctrl+C to disconnect.\n');
}

main().catch((error) => {
    process.stderr.write(`fatal: ${error?.message ?? error}\n`);
    process.exitCode = 1;
});
