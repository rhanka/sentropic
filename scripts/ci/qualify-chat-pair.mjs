import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Make target mounts only this probe, the candidate archives and an output directory.
const root = mkdtempSync(join(tmpdir(), 'chat-pair-'));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run('npm', ['install', '--no-audit', '--no-fund', '/input/ui.tgz', '/input/runtime.tgz',
  'svelte@5.55.7', 'svelte-check@4.7.6', 'typescript@5.9.3', 'vite@7.3.5', '@sveltejs/vite-plugin-svelte@6.2.4']);
writeFileSync(join(root, 'App.svelte'), `<script lang="ts">
  import ChatConversation from '@sentropic/chat-ui/components/ChatConversation.svelte';
  import { createConversationRuntime } from '@sentropic/chat-runtime/state/conversationRuntime';
  import { createDefaultTransport } from '@sentropic/chat-runtime/client/transport';
  import { createStreamHub } from '@sentropic/chat-runtime/client/streamHub';
  const streamClient = createStreamHub({ getBaseUrl: () => 'http://example.test', getAuthState: () => true });
  const runtime = createConversationRuntime('session', { host: { ...createDefaultTransport('http://example.test'), streamClient } });
</script>
<ChatConversation snapshots={runtime} commands={runtime.commands} features={{ attachments: true, documents: true }} />
`);
writeFileSync(join(root, 'main.js'), "import { mount } from 'svelte'; import App from './App.svelte'; mount(App, { target: document.body });\n");
writeFileSync(join(root, 'index.html'), '<html><body><script type="module" src="/main.js"></script></body></html>');
writeFileSync(join(root, 'vite.config.js'), "import { defineConfig } from 'vite'; import { svelte } from '@sveltejs/vite-plugin-svelte'; export default defineConfig({ plugins: [svelte()] });\n");
writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
  target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, lib: ['ES2022', 'DOM'],
}, include: ['App.svelte'] }));
run(join(root, 'node_modules/.bin/svelte-check'), ['--tsconfig', './tsconfig.json', '--fail-on-warnings']);
run(join(root, 'node_modules/.bin/vite'), ['build']);
const files = spawnSync('tar', ['-tzf', '/input/ui.tgz'], { encoding: 'utf8' });
if (files.status !== 0 || /package\/(src|dist\/(client|checkpoints|stores\/localTools))\//.test(files.stdout)
  || /chatLoopController|chatSessionRuntime|chatSessionHydration|localToolStreamSync/.test(files.stdout)) {
  throw new Error('Visual archive contains a source/runtime implementation path');
}
const hashes = Object.fromEntries(['ui', 'runtime'].map((name) => [name,
  createHash('sha256').update(readFileSync(`/input/${name}.tgz`)).digest('hex')]));
writeFileSync('/reports/chat-pair.json', JSON.stringify({ status: 'passed', hashes, checks: ['installed public contracts', 'Svelte typecheck', 'Vite production build', 'visual archive ownership'] }, null, 2));
console.log(`PASS installed chat pair ${JSON.stringify(hashes)}`);
