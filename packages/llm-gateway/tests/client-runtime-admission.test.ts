/**
 * Published client runtime admission (L0, spec 7.3/10.1).
 *
 * The manifest is an admission classification, not a qualification: every row
 * resolves against its pinned official distribution before job admission, an
 * npm launcher never proves a Node-only runtime, and a local pass never
 * qualifies a CI cell. Python runtimes run on the owner machine only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  classifyClientRuntime,
  loadClientsManifest,
  type VendorRuntimeKind,
} from '../src/client-runtime-admission.js';

const manifestJson: unknown = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../tools/gateway-evolution/clients.json'),
    'utf8',
  ),
);

const manifest = loadClientsManifest(manifestJson);

const cloneManifest = (): Record<string, unknown> =>
  structuredClone(manifestJson) as unknown as Record<string, unknown>;

const clientsOf = (root: Record<string, unknown>): Record<string, Record<string, unknown>> =>
  (root.clients as unknown as Record<string, Record<string, unknown>>);

describe('loadClientsManifest', () => {
  it('loads the L0 inventory with schemaVersion 1 and seventeen clients', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(Object.keys(manifest.clients)).toHaveLength(17);
  });

  it('refuses unknown top-level keys (closed manifest)', () => {
    const tampered = cloneManifest();
    tampered.extra = true;
    expect(() => loadClientsManifest(tampered)).toThrow(/unknown manifest key/);
  });

  it('refuses an unknown vendorRuntime kind', () => {
    const tampered = cloneManifest();
    const vibe = { ...clientsOf(tampered).vibe };
    vibe.vendorRuntime = {
      ...((vibe.vendorRuntime ?? {}) as Record<string, unknown>),
      kind: 'wasm' as unknown as VendorRuntimeKind,
    };
    clientsOf(tampered).vibe = vibe;
    expect(() => loadClientsManifest(tampered)).toThrow(/unknown vendorRuntime kind/);
  });

  it('refuses an unknown row key', () => {
    const tampered = cloneManifest();
    clientsOf(tampered).vibe = { ...clientsOf(tampered).vibe, binary: '/usr/bin/vibe' };
    expect(() => loadClientsManifest(tampered)).toThrow(/unknown client key/);
  });
});

describe('classifyClientRuntime', () => {
  it('refuses every unresolved row in a private job (no receipt, no admission)', () => {
    for (const [id, row] of Object.entries(manifest.clients)) {
      const decision = classifyClientRuntime(row, 'private-job');
      expect(decision.admitted).toBe(false);
      expect(decision.reason).toMatch(/unresolved-receipt|unknown-runtime|python-runtime/);
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('refuses unknown runtimes on the owner machine until distribution inspection proves them', () => {
    expect(classifyClientRuntime(manifest.clients.vibe, 'owner-machine')).toEqual({
      admitted: false,
      reason: 'unknown-runtime, job-excluded-until-proven',
    });
    expect(classifyClientRuntime(manifest.clients.muse, 'owner-machine')).toEqual({
      admitted: false,
      reason: 'unknown-runtime, job-excluded-until-proven',
    });
  });

  it('keeps python runtimes owner-machine-only with an explicit job-excluded reason', () => {
    for (const id of ['aider', 'hermes'] as const) {
      expect(classifyClientRuntime(manifest.clients[id], 'private-job')).toEqual({
        admitted: false,
        reason: 'unqualified (python-runtime, job-excluded)',
      });
    }
  });

  it('admits a resolved native/node row only in its allowed contexts', () => {
    const resolved = {
      ...manifest.clients.claude,
      digest: `sha256:${'0'.repeat(64)}`,
      status: 'resolved',
    };
    expect(classifyClientRuntime({ ...resolved }, 'private-job')).toEqual({
      admitted: true,
      reason: 'resolved native/node row in an allowed context',
    });
    expect(
      classifyClientRuntime(
        { ...resolved, allowedContexts: ['owner-machine'] },
        'private-job',
      ),
    ).toEqual({ admitted: false, reason: 'context-not-allowed' });
  });

  it('never admits a resolved row whose runtime is still unknown', () => {
    const resolvedUnknown = {
      ...manifest.clients.vibe,
      digest: `sha256:${'0'.repeat(64)}`,
      status: 'resolved',
    };
    expect(classifyClientRuntime({ ...resolvedUnknown }, 'owner-machine')).toEqual({
      admitted: false,
      reason: 'unknown-runtime, job-excluded-until-proven',
    });
  });
});
