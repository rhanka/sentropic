import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { contentHeaders } from '/repo/packages/artifacts/src/content/headers.ts';

let server: Server;
let origin: string;
const requests: string[] = [];
const imports = JSON.stringify({ imports: {
  maplibre: '/maplibre-gl/dist/maplibre-gl.mjs',
  geo: '/maplibre-geo/dist/maplibre-gl.mjs',
  pdf: '/pdfjs-dist/build/pdf.mjs',
  'document-only': '/value.mjs',
} });
const hash = `'sha256-${createHash('sha256').update(imports).digest('base64')}'`;
const entry = `
window.probe = async (name) => {
  const lib = await import(name);
  if (name === 'pdf') {
    lib.GlobalWorkerOptions.workerSrc = '/pdfjs-dist/build/pdf.worker.mjs';
    const worker = new lib.PDFWorker({ name: 'spike-pdf' });
    await worker.promise;
    window.worker = worker;
  } else {
    lib.setWorkerCount(1);
    lib.prewarm();
  }
  return { loaded: true };
};
window.bareWorker = () => new Promise(resolve => {
  const worker = new Worker('/bare-worker.mjs', { type: 'module' });
  worker.onmessage = () => resolve('resolved');
  worker.onerror = event => { event.preventDefault(); resolve('rejected'); };
});
`;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    requests.push(path);
    try {
      let body: Buffer;
      let mime = 'text/javascript';
      if (path === '/') {
        mime = 'text/html';
        body = Buffer.from(`<script type="importmap">${imports}</script><script type="module" src="/entry.mjs"></script>`);
      } else if (path === '/entry.mjs') body = Buffer.from(entry);
      else if (path === '/value.mjs') body = Buffer.from('export default 42');
      else if (path === '/bare-worker.mjs') body = Buffer.from("import x from 'document-only'; postMessage(x)");
      else {
        if (!/^\/(maplibre-gl|maplibre-geo|pdfjs-dist)\/[\w./-]+\.mjs$/.test(path) || path.includes('..')) throw Error('unlisted');
        body = await readFile(`/tools/node_modules${path}`);
      }
      res.writeHead(200, contentHeaders({ mimeType: mime, size: body.length, mode: 'application', scriptHashes: [hash] }));
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

for (const name of ['maplibre', 'geo', 'pdf']) {
  test(`should start ${name} module worker under application headers`, async ({ page }, info) => {
    const workers: string[] = [];
    const warnings: string[] = [];
    const violations: unknown[] = [];
    page.on('worker', worker => workers.push(worker.url()));
    page.on('console', message => { if (/fake worker|content security policy/i.test(message.text())) warnings.push(message.text()); });
    await page.exposeFunction('violation', (value: unknown) => violations.push(value));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event =>
      (window as any).violation({ directive: event.violatedDirective, uri: event.blockedURI })));
    const start = requests.length;
    await page.goto(origin);
    await page.waitForFunction(() => typeof (window as any).probe === 'function');
    await page.evaluate(name => (window as any).probe(name), name);
    await expect.poll(() => workers.length).toBeGreaterThan(0);
    const worker = page.workers()[0];
    // Evaluating in the worker proves the module and its imports finished loading.
    expect(await worker.evaluate(() => typeof self.postMessage)).toBe('function');
    const loadedWorkerUrls = page.workers().map(worker => new URL(worker.url(), origin).href);
    await info.attach('worker-evidence', { body: JSON.stringify({ N: 1, workers, loadedWorkerUrls, requests: requests.slice(start), warnings, violations }), contentType: 'application/json' });
    expect(loadedWorkerUrls.every(url => url.startsWith(origin) && !url.startsWith('blob:'))).toBe(true);
    // 6.14.0 publishes self-contained modules; 6.4.1 imports its shared file.
    if (name === 'maplibre') expect(requests.slice(start)).toContain('/maplibre-gl/dist/maplibre-gl-shared.mjs');
    expect(warnings).toEqual([]);
    expect(violations).toEqual([]);
  });
}

test('should reject document import-map specifiers inside a worker', async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof (window as any).bareWorker === 'function');
  expect(await page.evaluate(() => (window as any).bareWorker())).toBe('rejected');
});

test('should prevent opaque-frame preview from starting workers', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto(origin);
  await page.evaluate(url => {
    const frame = document.createElement('iframe');
    frame.sandbox.add('allow-scripts');
    frame.src = url;
    document.body.append(frame);
  }, origin);
  // Exact application policy denies framing as well as opaque-origin worker use.
  expect(await page.locator('iframe').count()).toBe(1);
  expect(workers).toEqual([]);
});
