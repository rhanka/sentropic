import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(`${process.env.HONO_TEST_ROOT ?? process.cwd()}/package.json`);
const { Hono } = await import(pathToFileURL(require.resolve('hono')));
const { serve } = await import(pathToFileURL(require.resolve('@hono/node-server')));

test('raw and encoded backslashes must never dispatch to a protected route', async () => {
  const app = new Hono();
  let protectedHits = 0;
  app.get('/public/ok', c => c.text('public'));
  app.get('/admin', c => { protectedHits++; return c.text('protected'); });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const get = path => new Promise((resolve, reject) => {
    // http.request preserves the wire path; fetch would normalize it before sending.
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    assert.deepEqual(await get('/public/ok'), { status: 200, body: 'public' });
    for (const path of [
      '/public/..\\admin', '/public\\..\\admin', '/public/%2e%2e\\admin',
      '/public/..%5cadmin', '/public/%2e%2e%5cadmin', '/public/%2E%2E%5Cadmin',
      '/public/%252e%252e%255cadmin',
    ]) {
      const response = await get(path);
      assert.ok([400, 404].includes(response.status), `${path}: ${JSON.stringify(response)}`);
      assert.equal(protectedHits, 0, `${path} reached the protected handler`);
      assert.notEqual(response.body, 'protected');
    }
    assert.deepEqual(await get('/admin'), { status: 200, body: 'protected' });
    assert.equal(protectedHits, 1, 'positive control must reach the protected handler');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
