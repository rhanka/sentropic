/**
 * Packaging entry for the single Windows .exe.
 *
 * Mirrors `bin/cowork.mjs` but imports the library from source (`../src/index.ts`)
 * instead of `../dist/index.js`, so esbuild can bundle the whole library +
 * `@sentropic/cowork-bridge` + `@sentropic/chat-ui` into one self-contained CJS
 * file. The optional native capture/input modules (`screenshot-desktop`,
 * `@nut-tree-fork/nut-js`) are kept EXTERNAL by the esbuild config — they are
 * loaded at runtime via dynamic `import()` from alongside the exe (see
 * `windows-provider.ts`). This file must stay behaviorally identical to
 * `bin/cowork.mjs`.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
    createFileStore,
    createWindowsCapabilityProvider,
    DeviceCodeClient,
    RegistryClient,
    ConsentManager,
    createToolResultsPoster,
    CoworkRunner,
} from '../src/index.ts';

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
