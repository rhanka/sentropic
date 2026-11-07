export const NPM_RELAY = 'http://npm-relay.npm-relay.svc.cluster.local:4873/';
export const BUILDER_IMAGE = 'docker.io/library/node@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68';
export const ARTIFACT_PUBLIC_ENV = Object.freeze({
  VITE_ARTIFACT_MODE: '1', VITE_API_BASE_URL: '/__app',
  VITE_BASEMAP_TILE_URL: '/__artifacts/tiles/v1/osm/{z}/{x}/{y}',
});
/** Construct from zero. Never inherit API, forge, npm credentials or branch-controlled config. */
export function artifactEnvironment() {
  return { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp/home', TMPDIR: '/tmp',
    npm_config_userconfig: '/tmp/host-npmrc', npm_config_globalconfig: '/tmp/host-global-npmrc',
    npm_config_cache: '/tmp/npm-cache', npm_config_registry: NPM_RELAY,
    npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_update_notifier: 'false', ...ARTIFACT_PUBLIC_ENV };
}
/** Decision 07/11 (b): a 384 V8 heap for install, pre-bundle and live; 1024 for the clean build only. */
export const NODE_HEAP_OPTIONS = '--max-old-space-size=384';
export const NODE_BUILD_HEAP_OPTIONS = '--max-old-space-size=1024';
/** Decision 07/11 (d), owned by W4: the live dev server and its pre-bundle see the base, its public VITE_* and heap 384. */
export function liveEnvironment() {
  return { ...artifactEnvironment(), NODE_OPTIONS: NODE_HEAP_OPTIONS };
}
/** Decision 07/11 (d), owned by W4: the clean build drops VITE_BASEMAP_TILE_URL (the repository wrapper owns it), heap 1024. */
export function buildEnvironment() {
  const { VITE_BASEMAP_TILE_URL: _tiles, ...base } = artifactEnvironment();
  return { ...base, NODE_OPTIONS: NODE_BUILD_HEAP_OPTIONS };
}
/** Pod-side Vite dependency pre-bundle; the bootstrap writes its frozen script, never a host file. */
export const PREBUNDLE_RECIPE = Object.freeze({
  executable: '/usr/local/bin/node', args: ['/tmp/artifact-vite-prebundle.mjs'], timeoutMs: 300_000,
});
export const INSTALL_RECIPE = Object.freeze({
  executable: '/usr/local/bin/npm', args: ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], timeoutMs: 300_000,
});
export const LIVE_RECIPE = Object.freeze({
  executable: '/usr/local/bin/node', args: ['/workspace/node_modules/vite/bin/vite.js',
    '--config', '/tmp/artifact-vite.config.mjs', '--host', '0.0.0.0', '--port', '5173', '--strictPort'], timeoutMs: 300_000,
});
export const BUILD_RECIPE = Object.freeze({
  executable: '/usr/local/bin/npm', args: ['--ignore-scripts', '--offline', 'run', 'build:artifact'], timeoutMs: 300_000,
});
/** Host-owned wrapper preserves qualified plugins while overriding writable repository server options. */
export function liveViteConfig(sessionId: string, podName: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId) || !/^artifact-[a-f0-9]{40}$/.test(podName)) throw new Error('Invalid live session');
  return `import { loadConfigFromFile } from '/workspace/node_modules/vite/dist/node/index.js';
const loaded = await loadConfigFromFile({command:'serve', mode:'development'}, '/workspace/ui/vite.config.ts');
const repo = loaded?.config ?? {};
export default {...repo, root:'/workspace/ui', envDir:'/tmp/artifact-empty-env', cacheDir:'/tmp/vite-cache',
  server:{host:'0.0.0.0', port:5173, strictPort:true, proxy:{}, cors:false,
    allowedHosts:[${JSON.stringify(`${podName}.sentropic-artifact-builders.svc.cluster.local`)}],
    hmr:{protocol:'wss', clientPort:443, path:${JSON.stringify(`/_live/${sessionId}/hmr`)}},
    fs:{strict:true, allow:['/workspace','/dependencies'], deny:['**/.env*','**/.git/**','**/*.pem','**/*.key']}}};`;
}
