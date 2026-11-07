import { describe, expect, it } from 'vitest';
import {
  INSTALL_RECIPE, LIVE_PREBUNDLE_SCRIPT, LIVE_RECIPE, LIVE_UPSTREAM_PORT, NODE_HEAP_OPTIONS, PREBUNDLE_RECIPE,
  artifactEnvironment, liveViteConfig,
} from '../../../src/services/artifacts/live/recipes';

const POD = `artifact-${'a'.repeat(40)}`;

describe('offline pod recipes (W2 static deny)', () => {
  it('should install offline from the staged npm cache without naming a registry', () => {
    expect(INSTALL_RECIPE.args).toEqual(['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
    expect(INSTALL_RECIPE.args.join(' ')).not.toContain('registry');
    expect(artifactEnvironment().npm_config_cache).toBe('/tmp/npm-cache');
  });

  it('should cap every worker Node heap with a host-owned NODE_OPTIONS', () => {
    expect(NODE_HEAP_OPTIONS).toBe('--max-old-space-size=384');
    expect(artifactEnvironment().NODE_OPTIONS).toBe('--max-old-space-size=384');
    expect(artifactEnvironment()).not.toBe(artifactEnvironment());
  });

  it('should pre-bundle through the host-owned driver and live wrapper into pod scratch only', () => {
    expect(PREBUNDLE_RECIPE).toEqual({ executable: '/usr/local/bin/node', args: ['/tmp/artifact-vite-prebundle.mjs'], timeoutMs: 300_000 });
    expect(LIVE_PREBUNDLE_SCRIPT).toContain("configFile:'/tmp/artifact-vite.config.mjs'");
    expect(LIVE_PREBUNDLE_SCRIPT).toContain("existsSync('/tmp/vite-cache/deps/_metadata.json')");
    expect(LIVE_PREBUNDLE_SCRIPT).toContain('middlewareMode:true, ws:false, watch:null');
    expect(liveViteConfig('s1', POD)).toContain("cacheDir:'/tmp/vite-cache'");
  });

  it('should bind Vite to loopback behind the bootstrap that owns :5173', () => {
    expect(LIVE_UPSTREAM_PORT).toBe(5174);
    expect(LIVE_RECIPE.args).toEqual(['/workspace/node_modules/vite/bin/vite.js', '--config',
      '/tmp/artifact-vite.config.mjs', '--host', '127.0.0.1', '--port', '5174', '--strictPort']);
    const config = liveViteConfig('s1', POD);
    expect(config).toContain("host:'127.0.0.1', port:5174, strictPort:true");
    expect(config).not.toContain('0.0.0.0');
    expect(config).toContain('"/_live/s1/hmr"');
  });
});
