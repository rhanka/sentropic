/**
 * Golden-file generator test (SPEC §6.1 #1, R10 invariant).
 *
 * Runs the REAL embedded `templates/chat-app/**` manifest through `resolvePlan` with a
 * fixed token set and asserts the rendered tree BYTE-FOR-BYTE against a committed golden
 * fixture (`fixtures/chat-app-golden.json`). Because the generator is pure (no
 * timestamps/random/env), the comparison is exact — any drift is a real change a reviewer
 * must see in the fixture diff.
 *
 * Regenerating the fixture (only when an intentional template change lands):
 *   make build-build-cli && node -e "import('./dist/manifest/chat-app.js')..." (see PR notes)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadChatAppManifest } from '../src/manifest/chat-app.js';
import { resolvePlan } from '../src/generator/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
    readFileSync(join(here, 'fixtures', 'chat-app-golden.json'), 'utf8'),
) as { tokens: Record<string, string>; files: { outputPath: string; content: string; mode?: number }[] };

function render() {
    return resolvePlan(loadChatAppManifest(), { tokens: golden.tokens });
}

function byPath(plan: ReturnType<typeof render>): Record<string, string> {
    return Object.fromEntries(plan.files.map((f) => [f.outputPath, f.content]));
}

describe('chat-app generator golden', () => {
    it('renders the real manifest byte-for-byte against the committed golden fixture', () => {
        const plan = render();
        expect(plan.files).toEqual(golden.files);
    });

    it('is deterministic: rendering twice yields a byte-identical plan (R10)', () => {
        expect(JSON.stringify(render())).toBe(JSON.stringify(render()));
    });

    it('preserves a stable output-path order matching the committed fixture', () => {
        const paths = render().files.map((f) => f.outputPath);
        expect(paths).toEqual(golden.files.map((f) => f.outputPath));
    });

    it('leaves NO unsubstituted {{token}} markers in any rendered file', () => {
        for (const file of render().files) {
            expect(file.content).not.toMatch(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/);
        }
    });

    it('materialises a .gitignore (NOT _gitignore) that excludes .env (no-secret-leak)', () => {
        const files = byPath(render());
        expect(files['.gitignore']).toBeDefined();
        expect(files['_gitignore']).toBeUndefined();
        expect(files['.gitignore'].split('\n')).toContain('.env');
    });

    it('backend mounts the published @sentropic/chat-server CANONICAL routes (does not own them)', () => {
        const server = byPath(render())['api/src/server.ts'];
        expect(server).toContain("from '@sentropic/chat-server'");
        expect(server).toContain('createChatServer(');
        expect(server).toContain('createInMemoryChatServerDeps(');
        expect(server).toContain("routes: 'canonical'");
    });

    it('declares NO unimplemented replay route or Sec-Sentropic-Wire-Version header anywhere', () => {
        for (const file of render().files) {
            expect(file.content).not.toMatch(/Sec-Sentropic-Wire-Version/i);
            expect(file.content).not.toMatch(/sessions\/[^/'"]*\/events/);
        }
    });

    it('pins the published @sentropic/* versions in the generated root package.json', () => {
        const pkg = JSON.parse(byPath(render())['package.json']) as {
            dependencies: Record<string, string>;
        };
        expect(pkg.dependencies['@sentropic/chat-server']).toBe('^0.1.0');
        expect(pkg.dependencies['@sentropic/chat-ui']).toBe('^0.1.1');
        expect(pkg.dependencies['@sentropic/chat-core']).toBe('^0.1.2');
        expect(pkg.dependencies['@sentropic/llm-mesh']).toBe('^0.1.2');
        expect(pkg.dependencies['@sentropic/design-system-svelte']).toBe('^0.34.69');
        expect(pkg.dependencies['@sentropic/design-system-themes']).toBe('^0.11.0');
        expect(pkg.dependencies['@sentropic/design-system-tokens']).toBe('^0.11.0');
    });

    it('UI embeds chat-ui via createDefaultTransport pointed at the backend base URL', () => {
        const app = byPath(render())['ui/src/App.svelte'];
        expect(app).toContain("from '@sentropic/chat-ui/components/ChatPanel.svelte'");
        expect(app).toContain('createDefaultTransport(baseUrl)');
        expect(app).toContain('VITE_API_BASE_URL');
    });

    it('compose project name is the app slug on non-reserved ports (never 8787/5173/1080)', () => {
        const compose = byPath(render())['docker-compose.yml'];
        expect(compose).toContain('name: demo');
        expect(compose).not.toMatch(/\b8787\b|\b5173\b|\b1080\b/);
    });
});
