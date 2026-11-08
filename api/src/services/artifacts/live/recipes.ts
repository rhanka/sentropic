import type { BuilderPlacement } from './placement';
export const NPM_RELAY = 'http://npm-relay.npm-relay.svc.cluster.local:4873/';
export const BUILDER_IMAGE = 'docker.io/library/node@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68';
/** VITE_BASEMAP_TILE_URL is owned by the repository build wrapper (owner decision 2026-11-07); the host never passes it. */
export const ARTIFACT_PUBLIC_ENV = Object.freeze({ VITE_ARTIFACT_MODE: '1', VITE_API_BASE_URL: '/__app' });
/** Host-owned V8 heap cap for every worker Node process (4 live pods per d2-4 node). It never caps esbuild's native memory. */
export const NODE_HEAP_OPTIONS = '--max-old-space-size=384';
/** The clean build alone needs a 1 GiB heap (immo measured: heap OOM at 384 and 768); its pod limit is 1536Mi. */
export const NODE_BUILD_HEAP_OPTIONS = '--max-old-space-size=1024';
/** Construct from zero. Never inherit API, forge, npm credentials or branch-controlled config. No registry: W2 offline. */
export function artifactEnvironment() {
  return { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp/home', TMPDIR: '/tmp', NODE_OPTIONS: NODE_HEAP_OPTIONS,
    npm_config_userconfig: '/tmp/host-npmrc', npm_config_globalconfig: '/tmp/host-global-npmrc',
    npm_config_cache: '/tmp/npm-cache', npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_update_notifier: 'false', ...ARTIFACT_PUBLIC_ENV };
}
/** Clean build only: the same host environment with the build heap. */
export function buildEnvironment() {
  return { ...artifactEnvironment(), NODE_OPTIONS: NODE_BUILD_HEAP_OPTIONS };
}
/** W2 static deny: verified tarballs are staged in the npm cache; the relay is never contacted from a pod. */
export const INSTALL_RECIPE = Object.freeze({
  executable: '/usr/local/bin/npm', args: ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], timeoutMs: 300_000,
});
/** The pod bootstrap owns :5173 in every phase and forwards live traffic to Vite on loopback. */
export const LIVE_UPSTREAM_PORT = 5174;
export const LIVE_RECIPE = Object.freeze({
  executable: '/usr/local/bin/node', args: ['/workspace/node_modules/vite/bin/vite.js',
    '--config', '/tmp/artifact-vite.config.mjs', '--host', '127.0.0.1', '--port', String(LIVE_UPSTREAM_PORT), '--strictPort'], timeoutMs: 300_000,
});
/** Runs inside the worker pod before the dev server. Its output stays in the pod's emptyDir cacheDir
 * (/tmp/vite-cache) and never enters the shared dependency cache. */
export const PREBUNDLE_RECIPE = Object.freeze({
  executable: '/usr/local/bin/node', args: ['/tmp/artifact-vite-prebundle.mjs'], timeoutMs: 300_000,
});
/** Host-owned pre-bundle driver. It runs Vite's dev pipeline with the live config (plugin buildStart hooks
 * included, so plugin cache metadata matches the dev server) but no HTTP, watcher or module transforms,
 * and exits once the optimizer commits deps/_metadata.json. `vite optimize` skips buildStart, so
 * vite-plugin-svelte would force a full re-optimization on the dev server's first render. */
export const LIVE_PREBUNDLE_SCRIPT = `import { existsSync } from 'node:fs';
import { createServer } from '/workspace/node_modules/vite/dist/node/index.js';
const server = await createServer({configFile:'/tmp/artifact-vite.config.mjs', mode:'development',
  server:{middlewareMode:true, ws:false, watch:null}, optimizeDeps:{holdUntilCrawlEnd:false}});
try {
  for (let i = 0; !existsSync('/tmp/vite-cache/deps/_metadata.json'); i++) {
    if (i >= 1100) throw new Error('Pre-bundle did not commit');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
} finally { await server.close(); }
process.exit(0);`;
export const BUILD_RECIPE = Object.freeze({
  executable: '/usr/local/bin/npm', args: ['--ignore-scripts', '--offline', 'run', 'build:artifact'], timeoutMs: 300_000,
});
/** Host-owned wrapper preserves qualified plugins while overriding writable repository server options. */
export function liveViteConfig(sessionId: string, podName: string, placement: BuilderPlacement) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId) || !/^artifact-[a-f0-9]{40}$/.test(podName)) throw new Error('Invalid live session');
  return `import { loadConfigFromFile } from '/workspace/node_modules/vite/dist/node/index.js';
const loaded = await loadConfigFromFile({command:'serve', mode:'development'}, '/workspace/ui/vite.config.ts');
const repo = loaded?.config ?? {};
export default {...repo, root:'/workspace/ui', envDir:'/tmp/artifact-empty-env', cacheDir:'/tmp/vite-cache',
  server:{host:'127.0.0.1', port:${LIVE_UPSTREAM_PORT}, strictPort:true, proxy:{}, cors:false,
    allowedHosts:[${JSON.stringify(`${podName}.${placement.serviceDomain}`)}],
    hmr:{protocol:'wss', clientPort:443, path:${JSON.stringify(`/_live/${sessionId}/hmr`)}},
    fs:{strict:true, allow:['/workspace','/dependencies'], deny:['**/.env*','**/.git/**','**/*.pem','**/*.key']}}};`;
}
