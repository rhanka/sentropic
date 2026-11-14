import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ivm from 'isolated-vm';
import { contentHeaders } from '/repo/packages/artifacts/src/content/headers.ts';

for (const size of ['S', 'M', 'L']) {
  test(`should emit identical F-LIVE-${size} bytes in isolate and browser worker`, async ({ page }, info) => {
    const bootstrap = await readFile('/tools/spike/bootstrap.js', 'utf8');
    const { source } = JSON.parse(await readFile(`/repo/packages/cluster-mesh/tests/compile-spike/fixtures/F-LIVE-${size}.json`, 'utf8'));
    const worker = `importScripts('/bootstrap.js');onmessage=event=>{try {
      postMessage({output:spike.compile(event.data),nfc:['e\\u0301','A\\u030a','\\u212b','\\u1100\\u1161'].map(s=>s.normalize('NFC'))});
      }catch(error){postMessage({error:String(error)})}};`;
    const server = createServer((req, res) => {
      const html = req.url === '/';
      const body = html ? '<title>Compiler probe</title>' : req.url === '/bootstrap.js' ? bootstrap : worker;
      res.writeHead(200, contentHeaders({ mimeType: html ? 'text/html' : 'text/javascript', size: Buffer.byteLength(body), mode: 'application' }));
      res.end(body);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const isolate = new ivm.Isolate({ memoryLimit: 256 });
    try {
      const context = await isolate.createContext();
      await context.eval(bootstrap);
      const output = await context.eval(`spike.compile(${JSON.stringify(source)})`, { copy: true });
      const nfc = await context.eval(`['e\\u0301','A\\u030a','\\u212b','\\u1100\\u1161'].map(s=>s.normalize('NFC'))`, { copy: true });
      await page.goto(origin);
      const actual = await page.evaluate(source => new Promise<any>((resolve, reject) => {
        const worker = new Worker('/worker.js');
        worker.onmessage = event => { resolve(event.data); worker.terminate(); };
        worker.onerror = event => reject(Error(event.message));
        worker.postMessage(source);
      }), source);
      expect(actual.error).toBeUndefined();
      expect(JSON.stringify(actual.output)).toBe(JSON.stringify(output));
      expect(actual.nfc).toEqual(nfc);
      await info.attach('compiler-equality', { body: JSON.stringify({ N: 1, size,
        bootstrapSha256: createHash('sha256').update(bootstrap).digest('hex'),
        outputSha256: createHash('sha256').update(JSON.stringify(output)).digest('hex'), nfc }), contentType: 'application/json' });
    } finally {
      isolate.dispose();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
