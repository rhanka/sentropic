import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { vi } from 'vitest';
import { BUILDER_REPOSITORIES_ENV, createForgeBindings, forgeConfig, type ForgeLeaseHost } from '../../../src/services/artifacts/live/forge-binding';
import { createLeaseForgeReads } from '../../../src/services/artifacts/live/forge-lease';
import { GB1_QUALIFICATION_PATH } from '../../../src/services/artifacts/live/gb1-qualification';
import { key, memoryRows } from './fixture';

/** Forge-lease-reader contract §1-§2 fixtures: one immo target, its builder repository and its host binding. */
export const INSTALLATION_REF = 'enroll_0123abcd-0000-4000-8000-000000000001';
export const target = { locator: 'rhanka/radar-immobilier', storageScopeId: key.storageScopeId, repoId: 'repo-immo' };
export const repository = { ...target, installationRef: INSTALLATION_REF, allowedSubPaths: [''] };
export const binding = { repoId: 'repo-immo', branch: 'artifact/demo', subPath: '' };
export const reposEnv = (value: unknown = [repository]) => ({ [BUILDER_REPOSITORIES_ENV]: JSON.stringify(value) });
/** The enabled SG0-app host with a second, non-builder target (rhanka/sentropic). */
export const leaseHost = (over: Partial<ForgeLeaseHost> = {}): ForgeLeaseHost => ({
  targets: [target, { locator: 'rhanka/sentropic', storageScopeId: key.storageScopeId, repoId: 'repo-sentropic' }],
  acquire: vi.fn(), subscribe: vi.fn(() => () => undefined), ...over });

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const HEAD = 'a'.repeat(40); export const TREE = 'f'.repeat(40); export const TOP = 'rhanka-radar-immobilier-aaaaaaa';
export type Entry = { path: string; data?: string | Buffer; type?: string; mode?: number; link?: string };
function header(name: string, size: number, type: string, mode = 0o644, link = '') {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8'); h.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 'latin1');
  h.write('0000000\0', 108); h.write('0000000\0', 116); h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  h.write('00000000000\0', 136); h.write('        ', 148); h.write(type, 156); h.write(link, 157); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const byte of h) sum += byte;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return h;
}
const padded = (data: Buffer) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
function paxRecord(name: string, value: string) {
  let length = name.length + value.length + 3;
  while (`${length} ${name}=${value}\n`.length !== length) length = `${length} ${name}=${value}\n`.length;
  return Buffer.from(`${length} ${name}=${value}\n`);
}
/** A git-archive style tarball: pax global header, top directory, ustar entries (pax path for long names). */
export function tarball(entries: Entry[]) {
  const global = paxRecord('comment', HEAD);
  const blocks = [header('pax_global_header', global.length, 'g'), padded(global), header(`${TOP}/`, 0, '5', 0o755)];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? ''); const name = `${TOP}/${e.path}`;
    if (name.length > 99) { const record = paxRecord('path', name); blocks.push(header('pax', record.length, 'x'), padded(record)); }
    blocks.push(header(name.slice(0, 99), data.length, e.type ?? '0', e.mode ?? 0o644, e.link ?? ''), padded(data));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
export const QUALIFICATION = JSON.stringify({ v: 1, lockSha256: '0'.repeat(64), postinstallAllowlist: [], scriptQualification: [] });
export const LONG = `src/${'deep/'.repeat(30)}file.ts`;
export const REPO: Entry[] = [
  { path: 'package.json', data: '{"name":"radar","scripts":{"build:artifact":"vite build"}}' },
  { path: 'package-lock.json', data: '{"lockfileVersion":3}' },
  { path: 'sentropic.artifact.json', data: JSON.stringify({ version: 1, buildScript: 'build:artifact', outputDir: 'dist', lockfilePath: 'package-lock.json' }) },
  { path: GB1_QUALIFICATION_PATH, data: QUALIFICATION }, { path: 'src/main.ts', data: 'export {};' },
  { path: 'bin/run.sh', data: '#!/bin/sh', mode: 0o755 }, { path: LONG, data: 'long' },
  { path: '.env', data: 'SECRET=1' }, { path: 'api/.env.local', data: 'SECRET=2' }, { path: 'sub/.npmrc', data: '//r/:_authToken=x' },
  { path: '.yarnrc.yml', data: 'x' }, { path: '.git/config', data: 'x' }, { path: 'certs/server.pem', data: 'x' },
  { path: 'certs/app.key', data: 'x' }, { path: 'node_modules/x/index.js', data: 'x' }, { path: 'node_modules/x/package.json', data: '{}' },
  { path: 'ui/dist/index.html', data: 'x' }, { path: 'dist/index.html', data: 'x' },
];
export const STAGED = ['bin/run.sh', GB1_QUALIFICATION_PATH, 'package-lock.json', 'package.json', 'sentropic.artifact.json', LONG, 'src/main.ts'].sort();

/** Mocked GitHub REST + codeload, and the reader over a recorded generation-1 binding. */
export async function setup(options: { compare?: Record<string, string>; config?: boolean; record?: boolean;
  generation?: (k: typeof key) => Promise<number>;
  units?: { get(ref: string): Promise<Uint8Array | undefined>; put(ref: string, bytes: Uint8Array): Promise<void> } } = {}) {
  let now = 1_700_000_000_000; let leases = 0; let refs = 0;
  const state = { archive: tarball(REPO), refused: new Set<string>(), location: '', branches: { 'artifact/demo': HEAD } as Record<string, string> };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init }); const u = new URL(url); const auth = (init.headers as Record<string, string>).authorization ?? '';
    if (u.origin === 'https://codeload.github.com' || u.origin === 'https://evil.example') return new Response(state.archive);
    if (state.refused.has(auth)) return new Response('{}', { status: 401 });
    const path = u.pathname.replace('/repos/rhanka/radar-immobilier', '');
    let m = /^\/git\/ref\/heads\/(.+)$/.exec(path);
    if (m) { const branch = decodeURIComponent(m[1]!); const sha = state.branches[branch];
      return sha ? Response.json({ ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } }) : new Response('{}', { status: 404 }); }
    if ((m = /^\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(path))) {
      const status = options.compare?.[m[1]!]; return status ? Response.json({ status }) : new Response('{}', { status: 404 }); }
    if ((m = /^\/git\/commits\/([0-9a-f]+)$/.exec(path))) return Response.json({ sha: m[1], tree: { sha: TREE } });
    if ((m = /^\/tarball\/([0-9a-f]+)$/.exec(path))) return new Response(null, { status: 302, headers: { location:
      state.location || `https://codeload.github.com/rhanka/radar-immobilier/legacy.tar.gz/${m[1]}?token=CODELOAD_SECRET` } });
    return new Response('{}', { status: 500 });
  });
  const subscribers: Array<(event: { storageScopeId: string; repoId: string }) => Promise<void>> = [];
  const acquire = vi.fn(async () => ({ token: `ghs_lease_secret_${++leases}`, expiresAt: new Date(now + 3_600_000).toISOString(),
    repositoryId: '1', permissions: { contents: 'write' as const, metadata: 'read' as const }, credentialVersion: 'v1' }));
  const host = leaseHost({ acquire, subscribe: vi.fn(s => { subscribers.push(s); return () => undefined; }) });
  const config = options.config === false ? null : forgeConfig(reposEnv(), host);
  const bindings = createForgeBindings(memoryRows(), config);
  if (options.record !== false && config) await bindings.admit(key, 1, binding);
  const reads = createLeaseForgeReads({ config, bindings, generation: options.generation ?? (async () => 1), fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => now, id: () => `stage-${++refs}`, ...(options.units ? { units: options.units } : {}) });
  return { reads, bindings, fetch, calls, acquire, subscribers, state, advance(ms: number) { now += ms; } };
}
export const failure = async (work: Promise<unknown>) => { try { await work; } catch (error) { return error as Error & { code: string }; } throw new Error('resolved'); };
