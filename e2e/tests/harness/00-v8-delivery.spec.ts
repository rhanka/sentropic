import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { contentHeaders } from '/repo/packages/artifacts/src/content/headers.ts';

let server: Server;
let origin: string;
const value = 'export default 42; window.moduleEvaluated = true;';
const digest = (text: string) => `sha256-${createHash('sha256').update(text).digest('base64')}`;
const pending = new Map<string, () => void>();
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const send = (body: string, mime = 'text/javascript', hashes?: string[]) => {
      res.writeHead(200, contentHeaders({ mimeType: mime, size: Buffer.byteLength(body), mode: 'application', scriptHashes: hashes }));
      res.end(body);
    };
    if (url.pathname === '/value.mjs') return send(value);
    if (url.pathname === '/patch.mjs') {
      pending.set(url.search, () => send(value));
      req.on('close', () => pending.delete(url.search));
      return;
    }
    if (url.pathname === '/entry.mjs') return send('import x from "witness"; window.result = x;');
    const integrity = url.searchParams.get('integrity');
    const map = JSON.stringify({ imports: { witness: '/value.mjs' },
      ...(integrity ? { integrity: { '/value.mjs': digest(integrity === 'bad' ? 'altered' : value) } } : {}) });
    send(`<script type="importmap">${map}</script><script type="module" src="/entry.mjs"></script>`,
      'text/html', [`'${digest(map)}'`]);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

test('should measure import-map integrity enforcement with an altered module control', async ({ page }, info) => {
  await page.goto(`${origin}/?integrity=good`);
  await page.waitForFunction(() => (window as any).result === 42);
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${origin}/?integrity=bad`);
  await page.waitForLoadState('domcontentloaded');
  const enforced = await page.evaluate(() => (window as any).result !== 42);
  await info.attach('integrity-capability', { body: JSON.stringify({ N: 1, good: true, alteredRefused: enforced, errors }), contentType: 'application/json' });
  // A probe records missing platform support; it never silently grants integrity.
  expect(typeof enforced).toBe('boolean');
});

test('should evaluate a pre-armed import when its held response is released', async ({ page }, info) => {
  await page.goto(origin);
  const rows = [];
  for (let index = 0; index < 20; index++) {
    const query = `?revision=${index}`;
    await page.evaluate(query => {
      (window as any).patch = import(`/patch.mjs${query}`).then(() => performance.now());
    }, query);
    await expect.poll(() => pending.has(query)).toBe(true);
    // The hold is the test stimulus, not an increased browser timeout.
    await new Promise(resolve => setTimeout(resolve, 100));
    const before = await page.evaluate(() => performance.now());
    pending.get(query)!();
    const evaluated = await page.evaluate(() => (window as any).patch);
    rows.push(evaluated - before);
  }
  rows.sort((a, b) => a - b);
  await info.attach('prearmed-delivery', { body: JSON.stringify({ N: rows.length,
    p50: rows[9], p95: rows[18], max: rows[19], clock: 'page performance.now; release command includes harness transit',
    edge: 'not measured', holdMs: 100, samples: rows }), contentType: 'application/json' });
});

test('should report the page clock resolution under unchanged application headers', async ({ page }, info) => {
  await page.goto(origin);
  const result = await page.evaluate(() => {
    const deltas: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 500000; i++) {
      const now = performance.now();
      if (now > last) deltas.push(now - last);
      last = now;
    }
    deltas.sort((a, b) => a - b);
    return { N: deltas.length, resolutionMs: deltas[0],
      p50: deltas[Math.ceil(deltas.length * .5) - 1], p95: deltas[Math.ceil(deltas.length * .95) - 1],
      crossOriginIsolated, timeOrigin: performance.timeOrigin };
  });
  expect(result.N).toBeGreaterThan(0);
  expect(result.resolutionMs).toBeGreaterThan(0);
  await info.attach('page-clock', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('should evaluate an import held beyond the edge ten-second window', async ({ page }, info) => {
  await page.goto(origin);
  const query = '?revision=long-hold';
  await page.evaluate(query => { (window as any).patch = import(`/patch.mjs${query}`); }, query);
  await expect.poll(() => pending.has(query)).toBe(true);
  // Intentional protocol stimulus: the production edge timeout is ten seconds.
  // This direct-origin test isolates the browser and leaves real-edge renewal open.
  await new Promise(resolve => setTimeout(resolve, 12000));
  pending.get(query)!();
  expect(await page.evaluate(async () => (await (window as any).patch).default)).toBe(42);
  await info.attach('long-hold', { body: JSON.stringify({ N: 1, holdMs: 12000,
    evaluated: true, productionEdge: 'not measured' }), contentType: 'application/json' });
});
