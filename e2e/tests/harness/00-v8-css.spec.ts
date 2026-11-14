import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { build } from 'vite';
import { contentHeaders } from '/repo/packages/artifacts/src/content/headers.ts';

test('should match Vite styles, cascade and same-origin font with unbundled stylesheet links', async ({ page }, info) => {
  const root = await mkdtemp('/tmp/v8-css-reference-');
  await symlink('/tools/node_modules', `${root}/node_modules`);
  const script = `import './app.css';import '@fontsource-variable/inter';import './override.css';
    document.body.innerHTML='<div class="proof order maplibregl-map">Sample</div>';`;
  const app = '@import "maplibre-gl/dist/maplibre-gl.css";\n.proof{font-family:"Inter Variable";padding-left:7px;color:rgb(12,34,56)}.order{margin-left:1px}';
  await writeFile(`${root}/index.html`, '<script type="module" src="/entry.js"></script>');
  await writeFile(`${root}/entry.js`, script);
  await writeFile(`${root}/app.css`, app);
  await writeFile(`${root}/override.css`, '.order{margin-left:2px}');
  await build({ root, base: '/reference/', logLevel: 'error' });
  // A bounded prototype of the three admitted CSS link forms, not the future linker.
  const linkedScript = script.replace(/import\s*['"][^'"]+['"];?/g, '');
  const linkedCss = app.replace('maplibre-gl/dist/maplibre-gl.css',
    '/node_modules/maplibre-gl/dist/maplibre-gl.css');
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    try {
      let body: string | Buffer;
      let mime: string;
      if (path === '/') {
        mime = 'text/html';
        body = '<link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/node_modules/@fontsource-variable/inter/index.css"><link rel="stylesheet" href="/override.css"><script type="module" src="/entry.js"></script>';
      } else if (path === '/entry.js') { body = linkedScript; mime = 'text/javascript'; }
      else if (path === '/app.css') { body = linkedCss; mime = 'text/css'; }
      else if (path === '/override.css') { body = '.order{margin-left:2px}'; mime = 'text/css'; }
      else {
        if (path.includes('..')) throw Error('unlisted');
        const file = path.startsWith('/reference/') ? `${root}/dist/${path.slice('/reference/'.length) || 'index.html'}`
          : /^\/node_modules\/(?:@fontsource-variable\/inter|maplibre-gl)\//.test(path) ? `/tools${path}` : '';
        if (!file) throw Error('unlisted');
        body = await readFile(file);
        mime = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html';
      }
      res.writeHead(200, contentHeaders({ mimeType: mime, size: Buffer.byteLength(body), mode: 'application' }));res.end(body);
    } catch { res.writeHead(404);res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const fonts: string[] = [];
  page.on('response', response => { if (response.url().endsWith('.woff2') && response.status() === 200) fonts.push(response.url()); });
  const read = async (path: string) => {
    await page.goto(`${origin}${path}`);
    await expect(page.locator('.proof')).toHaveText('Sample');
    return page.evaluate(async () => {
      await document.fonts.ready;
      const style = getComputedStyle(document.querySelector('.proof')!);
      return { color: style.color, padding: style.paddingLeft, margin: style.marginLeft,
        // Firefox preserves source quoting; Vite removes optional quotes.
        family: style.fontFamily.replace(/^['"]|['"]$/g, ''), serializedFamily: style.fontFamily,
        position: style.position, fontLoaded: [...document.fonts].some(face => face.family.includes('Inter Variable') && face.status === 'loaded') };
    });
  };
  try {
    const reference = await read('/reference/');
    const candidate = await read('/');
    for (const key of ['color', 'padding', 'margin', 'family', 'position', 'fontLoaded'] as const) expect(candidate[key]).toBe(reference[key]);
    expect(candidate.margin).toBe('2px');
    expect(candidate.position).toBe('relative');
    expect(candidate.fontLoaded).toBe(true);
    expect(fonts.some(url => url.startsWith(`${origin}/node_modules/`))).toBe(true);
    await info.attach('css-parity', { body: JSON.stringify({ N: 1, reference, candidate, fonts }), contentType: 'application/json' });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('should report the pinned DS theme refusal in the Vite reference', async ({}, info) => {
  const root = await mkdtemp('/tmp/v8-css-theme-');
  await symlink('/tools/node_modules', `${root}/node_modules`);
  await writeFile(`${root}/index.html`, '<script type="module" src="/entry.js"></script>');
  await writeFile(`${root}/entry.js`, 'import "@sentropic/design-system-themes/css/sent-tech.css"');
  let diagnostic = '';
  try { await build({ root, logLevel: 'silent' }); } catch (error) { diagnostic = String(error); }
  finally { await rm(root, { recursive: true, force: true }); }
  expect(diagnostic).toContain('Invalid token in pseudo element');
  await info.attach('ds-theme-baseline-refusal', { body: JSON.stringify({ N: 1,
    package: '@sentropic/design-system-themes@0.12.0', baselineBuilt: false, diagnostic }), contentType: 'application/json' });
});
