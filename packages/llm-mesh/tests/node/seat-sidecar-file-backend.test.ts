import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { inspectSeatStoreRecord } from '../../src/node/cli-seat-store-reader.js';
import { SeatSidecarFileBackend, parseSeatSidecar } from '../../src/node/seat-sidecar-file-backend.js';

const CANARY = 'canary-sidecar-secret-7d1a';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const sidecarFile = async (content: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'seat-sidecar-'));
  roots.push(root);
  const path = join(root, 'lab-agy-01.json');
  await writeFile(path, content);
  return path;
};

const validSidecar = (overrides = {}) =>
  JSON.stringify({
    cli: 'agy',
    profileLabel: 'lab-agy-01',
    schemaVersion: 'v1',
    credentialClass: 'renewable',
    refreshCapable: true,
    ...overrides,
  });

describe('seat-sidecar-file-backend', () => {
  it('reads categories from an explicitly provided sidecar', async () => {
    const path = await sidecarFile(validSidecar());
    const backend = new SeatSidecarFileBackend('agy', path);
    const descriptor = await inspectSeatStoreRecord([backend], { cli: 'agy', profileLabel: 'lab-agy-01' });
    expect(descriptor).toMatchObject({
      backend: 'file',
      schemaVersion: 'v1',
      credentialClass: 'renewable',
      refreshCapable: true,
      supported: true,
    });
  });

  it('requires an explicit path and never probes defaults', () => {
    expect(() => new SeatSidecarFileBackend('agy', '')).toThrow(/explicit sidecar path/);
  });

  it('returns unverified for selector mismatches and missing files', async () => {
    const path = await sidecarFile(validSidecar());
    const backend = new SeatSidecarFileBackend('agy', path);
    expect(
      await inspectSeatStoreRecord([backend], { cli: 'agy', profileLabel: 'lab-other-01' }),
    ).toMatchObject({ supported: false });
    const missing = new SeatSidecarFileBackend('codex', join('/nonexistent', 'nope.json'));
    expect(
      await inspectSeatStoreRecord([missing], { cli: 'codex', profileLabel: 'lab-codex-01' }),
    ).toMatchObject({ supported: false });
  });

  it('refuses malformed, oversized, and unbounded categories without echoing content', async () => {
    expect(() => parseSeatSidecar('{not-json')).toThrow(/not JSON/);
    expect(() => parseSeatSidecar('x'.repeat(5000))).toThrow(/bounded size/);
    expect(() => parseSeatSidecar(validSidecar({ credentialClass: CANARY }))).toThrow(/credential class/);
    expect(() => parseSeatSidecar(validSidecar({ schemaVersion: 'v'.repeat(65) }))).toThrow(/schema version/);
    expect(() => parseSeatSidecar(validSidecar({ schemaVersion: 'v1 hostile' }))).toThrow(/schema version/);
    expect(() => parseSeatSidecar(validSidecar({ schemaVersion: `v1\n${CANARY}` }))).toThrow(/schema version/);
    try {
      parseSeatSidecar(validSidecar({ schemaVersion: CANARY.repeat(4) }));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(CANARY);
    }
  });

  it('never forwards extra fields from the sidecar', async () => {
    const path = await sidecarFile(validSidecar({ secretMaterial: CANARY }));
    const backend = new SeatSidecarFileBackend('agy', path);
    const descriptor = await inspectSeatStoreRecord([backend], { cli: 'agy', profileLabel: 'lab-agy-01' });
    expect(JSON.stringify(descriptor)).not.toContain(CANARY);
  });
});
