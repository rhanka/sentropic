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
export const INSTALL_RECIPE = Object.freeze({
  executable: '/usr/local/bin/npm', args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund',
    '--registry', NPM_RELAY], timeoutMs: 300_000,
});
export const LIVE_RECIPE = Object.freeze({
  executable: '/usr/local/bin/node', args: ['/workspace/node_modules/vite/bin/vite.js',
    '--host', '0.0.0.0', '--port', '5173', '--strictPort'], timeoutMs: 300_000,
});
export const BUILD_RECIPE = Object.freeze({
  executable: '/usr/local/bin/npm', args: ['--ignore-scripts', '--offline', 'run', 'build:artifact'], timeoutMs: 300_000,
});
