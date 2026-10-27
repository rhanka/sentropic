import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { measureArtifact, reportTable } from './artifact-budget.mjs';
const { chromium } = createRequire('/tmp/artifact-probe/package.json')('playwright');
const root = resolve('.cache/artifact-weight/typical'), directory = resolve(root, 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer((request, response) => {
  const path = resolve(directory, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!path.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
  try { response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(readFileSync(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const requests = [], errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin + '/index.html');
  await page.locator('.architecture-figure').waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Capture startup fetches through the first usable dossier, including queued work.
  await page.waitForLoadState('networkidle');
  assert.deepEqual(errors, []);
  assert(requests.every(url => url.startsWith(origin + '/')), 'No external startup requests');
  const startupPaths = [...new Set(requests.map(url => new URL(url).pathname.slice(1)))].sort();
  const previous = JSON.parse(readFileSync(root + '/artifact-size-report.json'));
  const measured = measureArtifact({ directory, portablePath: directory + '/dossier-portable.html', startupPaths });
  const report = { ...previous, ...measured, startup: { cold: true, usable: true, requests: startupPaths } };
  writeFileSync(root + '/startup.json', JSON.stringify(report.startup, null, 2));
  writeFileSync(root + '/artifact-size-report.json', JSON.stringify(report, null, 2));
  writeFileSync(root + '/artifact-size-report.md', reportTable(report));
  console.log(reportTable(report));
  assert.deepEqual(report.violations, []);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
