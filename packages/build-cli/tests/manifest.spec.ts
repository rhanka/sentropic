/**
 * Manifest loader unit tests.
 *
 * The loader walks the embedded `templates/chat-app/**` subtree into a deterministic
 * `ScaffoldManifest`. These tests pin: a stable sorted walk (R10), the dotfile-safe
 * `_gitignore` -> `.gitignore` rename (npm drops literal `.gitignore`), token coverage
 * (every `{{token}}` the template references is one of the eight `buildTokens` produces),
 * and a fixture-root override so the contract is testable in isolation.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadChatAppManifest, CHAT_APP_TEMPLATE_DIR } from '../src/manifest/chat-app.js';
import { resolvePlan } from '../src/generator/index.js';
import { extractTokens } from '../src/templating/index.js';

/** The tokens `buildTokens` always populates (see commands/init.ts). */
const KNOWN_TOKENS = new Set([
    'name',
    'slug',
    'provider',
    'api_port',
    'ui_port',
    'maildev_port',
    'repo_url',
    'assistant_reply',
]);

describe('loadChatAppManifest — embedded subtree', () => {
    it('loads a non-empty manifest in a stable order across runs (R10)', () => {
        const a = loadChatAppManifest();
        const b = loadChatAppManifest();
        expect(a.entries.length).toBeGreaterThan(0);
        const pathsA = a.entries.map((e) => e.outputPath);
        const pathsB = b.entries.map((e) => e.outputPath);
        // Determinism: identical input -> identical order (not necessarily output-sorted,
        // since the _gitignore -> .gitignore rename moves the dot ahead of its source key).
        expect(pathsA).toEqual(pathsB);
        // The underlying walk IS sorted by source path (the stable canonical order).
        const sourcesA = a.entries.map((e) => e.sourcePath);
        expect([...sourcesA].sort()).toEqual(sourcesA);
    });

    it('maps the dotfile-safe _gitignore source to a .gitignore output', () => {
        const manifest = loadChatAppManifest();
        const entry = manifest.entries.find((e) => e.sourcePath.endsWith('_gitignore'));
        expect(entry).toBeDefined();
        expect(entry?.outputPath).toBe('.gitignore');
        // No entry should ever output a literal _gitignore.
        expect(manifest.entries.some((e) => e.outputPath === '_gitignore')).toBe(false);
    });

    it('only references tokens that buildTokens populates', () => {
        const manifest = loadChatAppManifest();
        for (const entry of manifest.entries) {
            for (const token of [...extractTokens(entry.outputPath), ...extractTokens(entry.content)]) {
                expect(KNOWN_TOKENS).toContain(token);
            }
        }
    });

    it('defaults the template dir to the package-root templates/chat-app', () => {
        expect(CHAT_APP_TEMPLATE_DIR.replace(/\\/g, '/')).toMatch(/templates\/chat-app$/);
    });
});

describe('loadChatAppManifest — fixture root override (hermetic)', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'build-cli-manifest-'));
        await writeFile(join(root, 'package.json'), '{ "name": "{{slug}}" }\n');
        await writeFile(join(root, '_gitignore'), 'node_modules\n.env\n');
        await mkdir(join(root, 'api'), { recursive: true });
        await writeFile(join(root, 'api', 'server.ts'), "export const p = '{{provider}}';\n");
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('walks a fixture subtree, renames _gitignore, and renders deterministically', () => {
        const manifest = loadChatAppManifest(root);
        const plan = resolvePlan(manifest, {
            tokens: { slug: 'demo', provider: 'stub' },
        });
        const byPath = Object.fromEntries(plan.files.map((f) => [f.outputPath, f.content]));
        expect(Object.keys(byPath).sort()).toEqual(['.gitignore', 'api/server.ts', 'package.json']);
        expect(byPath['package.json']).toBe('{ "name": "demo" }\n');
        expect(byPath['.gitignore'].split('\n')).toContain('.env');
        expect(byPath['api/server.ts']).toBe("export const p = 'stub';\n");
    });
});
