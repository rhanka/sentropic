import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';

// Compile the shipped component and its design-system primitives, then inspect its server HTML.
const root = fileURLToPath(new URL('..', import.meta.url));
const renderConsent = async (resource: string | null) => {
  const output = await build({
    stdin: { contents: `import { render } from 'svelte/server';
      import Consent from './src/components/OAuthConsent.svelte';
      export default props => render(Consent, { props }).body;`, resolveDir: root },
    bundle: true, write: false, platform: 'node', format: 'esm', conditions: ['svelte', 'node'],
    plugins: [{ name: 'svelte-server', setup(builder) {
      builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
        contents: compile(await readFile(path, 'utf8'), { filename: path, generate: 'server' }).js.code,
        resolveDir: dirname(path), loader: 'js',
      }));
    } }],
  });
  const module = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
  return module.default({ state: 'state', transport: {}, initialDetails: {
    clientName: 'Immo MCP', redirectUri: 'https://client.test/cb', scopes: ['immo:search', 'offline_access'],
    offline: { issuer: 'https://idp.test', resource, audience: resource ?? 'https://idp.test/oauth/userinfo',
      scopes: ['immo:search', 'offline_access'], familyLifetimeDays: 15 },
  } });
};

describe('visible offline consent', () => {
  it.each(['https://immo.test/mcp', null])('should show exact offline authority for %s', async (resource) => {
    const html = await renderConsent(resource);
    for (const text of ['Immo MCP', 'https://idp.test', 'immo:search', 'offline_access', '15 days', 'all its token families']) {
      expect(html).toContain(text);
    }
    expect(html).toContain(resource ?? 'Default audience');
    expect(html).toContain(resource ?? 'https://idp.test/oauth/userinfo');
  });
});
