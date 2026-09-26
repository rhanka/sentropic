import { spawn } from 'node:child_process';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// check-lock-integrity.mjs `registry` against a local fake registry: a package published by this run is
// retried until visible, then fails; a package not published by this run stays notice-only.
const HERE = dirname(fileURLToPath(import.meta.url));
const TRAIN = { '@sentropic/llm-mesh': '0.22.0', '@sentropic/llm-gateway': '0.19.0' } as const;
type Name = keyof typeof TRAIN;
const url = (name: string, version: string) => `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${version}.tgz`;
const integrity = (name: string) => `sha512-${name}`;

let dir: string;
let server: Server;
let base: string;
let requests: { url: string; headers: IncomingHttpHeaders }[];
/** Lookup number (1-based) from which each package's pinned version is visible; absent = never. */
let visibleFrom: Partial<Record<Name, number>>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cluster-lock-registry-'));
  writeFileSync(join(dir, 'lock.json'), JSON.stringify({ packages: Object.fromEntries(Object.entries(TRAIN).map(([name, version]) =>
    [`node_modules/${name}`, { version, resolved: url(name, version), integrity: integrity(name) }])) }));
  requests = [];
  visibleFrom = {};
  server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', headers: req.headers });
    const name = decodeURIComponent((req.url ?? '').slice(1).split('?')[0]!) as Name;
    const seen = requests.filter((r) => decodeURIComponent(r.url.slice(1).split('?')[0]!) === name).length;
    const version = TRAIN[name];
    const versions = visibleFrom[name] !== undefined && seen >= visibleFrom[name]!
      ? { [version]: { dist: { tarball: url(name, version), integrity: integrity(name) } } } : {};
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ name, versions }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const run = (...required: string[]) => new Promise<{ status: number | null; out: string }>((resolve) => {
  const child = spawn(process.execPath, [join(HERE, 'check-lock-integrity.mjs'), 'registry', join(dir, 'lock.json'), ...required], {
    env: { ...process.env, CLUSTER_MESH_REGISTRY_LOOKUP_URL: base, CLUSTER_MESH_REGISTRY_RETRIES: '4', CLUSTER_MESH_REGISTRY_DELAY_MS: '10' },
  });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.on('close', (status) => resolve({ status, out }));
});
const lookups = (name: Name) => requests.filter((r) => r.url.startsWith(`/${name.replace('/', '%2f')}?`));

describe('train lock integrity against the registry', () => {
  it('should retry a package published in this run until visible, with cache-bypassing lookups', async () => {
    visibleFrom = { '@sentropic/llm-mesh': 3, '@sentropic/llm-gateway': 1 };
    const result = await run('@sentropic/llm-mesh', '@sentropic/llm-gateway');
    expect(result.status, result.out).toBe(0);
    expect(result.out).toContain('[lock] @sentropic/llm-mesh@0.22.0 registry integrity matches the committed lock');
    expect(lookups('@sentropic/llm-mesh')).toHaveLength(3);
    expect(new Set(lookups('@sentropic/llm-mesh').map((r) => r.url)).size).toBe(3);
    expect(lookups('@sentropic/llm-mesh').every((r) => r.headers['cache-control'] === 'no-cache')).toBe(true);
  });

  it('should fail when a package published in this run stays absent after every retry', async () => {
    visibleFrom = { '@sentropic/llm-gateway': 1 };
    const result = await run('@sentropic/llm-mesh', '@sentropic/llm-gateway');
    expect(result.status).toBe(1);
    expect(result.out).toContain('::error title=Train lock integrity::@sentropic/llm-mesh@0.22.0 was published in this run but is absent from the registry after 4 attempts');
    expect(lookups('@sentropic/llm-mesh')).toHaveLength(4);
  });

  it('should only notice an absent package that this run did not publish, with a single lookup', async () => {
    visibleFrom = { '@sentropic/llm-mesh': 1 };
    const result = await run('@sentropic/llm-mesh');
    expect(result.status, result.out).toBe(0);
    expect(result.out).toContain('::notice title=Train lock integrity::@sentropic/llm-gateway@0.19.0 is not published; nothing to compare');
    expect(lookups('@sentropic/llm-gateway')).toHaveLength(1);
  });

  it('should refuse a required package outside the train', async () => {
    const result = await run('@sentropic/cluster-mesh');
    expect(result.status).toBe(2);
    expect(requests).toHaveLength(0);
  });
});
