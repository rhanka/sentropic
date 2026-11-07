import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGasDigest } from '../../src/gas/digest.js';
import { StoreRefusedError, VersionConflictError } from '../../src/gas/errors.js';
import { canonicalize } from '../../src/gas/jcs.js';
import { acceptsVersion, loadRegistry, type RegistryEntry } from '../../src/gas/registry.js';
import { assertPinned, createBuildStore } from '../../src/gas/store.js';
// @ts-expect-error vendored plain .mjs
import { canonicalize as nodeCanonicalize, validateEnvelope } from './n3/validate-dossier.mjs';
import { mockUtilities } from './harness.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const N3 = join(HERE, 'n3');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const PINS = {
  validatorSha256: 'c5b3afcebd966458c3721842d4dbacbff4605206bb5296b593d0d160efad2ea4',
  rendererSha256: '6a6e62aa90c4df44625539a763cdf6839de6ae6094bd1bb0b0dfd32ede77d305',
};
const digest = createGasDigest(mockUtilities());
const fixture = (n: string) => JSON.parse(readFileSync(join(N3, 'fixtures', `${n}.json`), 'utf8'));
// validate-dossier is async (dynamic import of the pinned validator): verdicts are resolved first, then replayed synchronously.
const verdicts = new Map<string, any[]>();
for (const f of readdirSync(join(N3, 'fixtures'))) {
  const env = JSON.parse(readFileSync(join(N3, 'fixtures', f), 'utf8'));
  verdicts.set(JSON.stringify(env), await validateEnvelope(env));
}
const validate = (env: unknown) => verdicts.get(JSON.stringify(env)) ?? [{ path: '$', msg: 'unknown envelope (not pre-validated)' }];
const newStore = (initial: RegistryEntry[] = []) => createBuildStore({ digest, tenantId: 'airbus', pins: PINS, validate, initial });
const withVersion = (name: string, version: number) => {
  const env = fixture(name);
  env.artifact.version = version;
  verdicts.set(JSON.stringify(env), []); // version variants of a valid fixture stay valid; only the version rule is under test
  return env;
};

describe('N3 frozen assets', () => {
  it('CONTRACT.md is the frozen r3.1 file and the vendored pins match', () => {
    expect(sha(readFileSync(join(N3, 'CONTRACT.md')))).toBe('c47265f557dddf3cf91d5bc4fae246574a3e9c081db13ba7302da92f96f340d5');
    assertPinned('validator', sha(readFileSync(join(N3, 'vendor/focus-kit/validator.mjs'))), PINS.validatorSha256);
    assertPinned('renderer', sha(readFileSync(join(N3, 'vendor/focus-kit/renderer.html'))), PINS.rendererSha256);
    expect(() => assertPinned('validator', 'f'.repeat(64), PINS.validatorSha256)).toThrow(/build_pin_mismatch/);
  });
  it('pure JCS equals the contract canonicalize on every fixture payload', () => {
    for (const f of readdirSync(join(N3, 'fixtures'))) {
      const p = JSON.parse(readFileSync(join(N3, 'fixtures', f), 'utf8')).payload;
      expect(canonicalize(p)).toBe(nodeCanonicalize(p));
    }
    expect(() => canonicalize({ a: 'x\ud800' })).toThrow(StoreRefusedError);
  });
});

describe('G3 acceptance fixtures (A5 S1 form: build gate)', () => {
  it.each(['valid-v1', 'valid-no-diagram'])('%s is published as version 1 and re-hashes to its sealed digest', (name) => {
    const env = fixture(name);
    const store = newStore();
    const { entry, buildChecked } = store.publish(env);
    expect(entry.payloadSha256).toBe(env.integrity.payloadSha256);
    expect(entry.bytes).toBe(Buffer.byteLength(nodeCanonicalize(env.payload)));
    expect(entry).toMatchObject({ id: env.artifact.id, version: 1, tenantId: 'airbus' });
    expect(buildChecked).toBe(false); // payload.build pending (R5): reported, never silently assumed
  });
  it.each(['invalid-closed-doc', 'invalid-ecosystem', 'invalid-external-url', 'invalid-integrity', 'invalid-residency', 'invalid-secret'])(
    '%s is refused and leaves the store empty',
    (name) => {
      const store = newStore();
      expect(() => store.publish(fixture(name))).toThrow(StoreRefusedError);
      expect(store.entries()).toEqual([]);
    },
  );
  it('re-validates independently: a tampered payload with a stale seal is refused even if the validator is lenient', () => {
    const env = fixture('valid-v1');
    env.payload.render.root.document.title += ' (edited)';
    const lenient = createBuildStore({ digest, tenantId: 'airbus', pins: PINS, validate: () => [] });
    expect(() => lenient.publish(env)).toThrow(/integrity_mismatch/);
  });
  it('payload.build with a foreign validator or renderer sha is refused; matching pins are reported as checked', () => {
    const lenient = createBuildStore({ digest, tenantId: 'airbus', pins: PINS, validate: () => [] });
    const seal = (build: object) => {
      const env = fixture('valid-v1');
      env.payload.build = build;
      env.integrity.payloadSha256 = sha(nodeCanonicalize(env.payload));
      return env;
    };
    expect(() => lenient.publish(seal({ validatorSha256: '0'.repeat(64), rendererSha256: PINS.rendererSha256 }))).toThrow(/build_pin_mismatch/);
    expect(() => lenient.publish(seal({ validatorSha256: PINS.validatorSha256, rendererSha256: '0'.repeat(64) }))).toThrow(/build_pin_mismatch/);
    expect(lenient.publish(seal({ validatorSha256: PINS.validatorSha256, rendererSha256: PINS.rendererSha256 })).buildChecked).toBe(true);
  });
});

describe('A4 version rule (one predicate, both gates)', () => {
  it('1,2,3 accepted in sequence', () => {
    const store = newStore();
    for (const v of [1, 2, 3]) expect(store.publish(withVersion('valid-v1', v)).entry.version).toBe(v);
  });
  it.each([
    ['1 again', [1], 1],
    ['5 after 3', [1, 2, 3], 5],
    ['4 after 2 (gap)', [1, 2], 4],
    ['0', [], 0],
    ['-1', [], -1],
    ['"2" (string)', [1], '2'],
    ['1.5', [1], 1.5],
    ['2 first', [], 2],
  ])('refuses %s with version_conflict', (_label, seed, bad) => {
    const store = newStore();
    for (const v of seed as number[]) store.publish(withVersion('valid-v1', v));
    const env = fixture('valid-v1');
    env.artifact.version = bad;
    verdicts.set(JSON.stringify(env), []);
    expect(() => store.publish(env)).toThrow(VersionConflictError);
    try { store.publish(env); } catch (e: any) { expect(e.code).toBe('version_conflict'); }
    expect(store.entries().length).toBe((seed as number[]).length);
  });
  it('the predicate itself', () => {
    expect([acceptsVersion(0, 1), acceptsVersion(3, 4), acceptsVersion(3, 3), acceptsVersion(3, 5), acceptsVersion(0, 0), acceptsVersion(0, '1')]).toEqual([true, true, false, false, false, false]);
  });
  const e = (id: string, version: number): RegistryEntry => ({ id, version, tenantId: 'airbus', file: `dossiers/${id}-v${version}.html`, title: 't', createdAt: '2026-11-07T18:00:00Z', payloadSha256: 'a'.repeat(64), bytes: 10 });
  it('registry load refuses gaps, duplicates and disorder, accepts contiguous interleaved ids', () => {
    expect(() => loadRegistry([e('abc', 1), e('abc', 3)])).toThrow(VersionConflictError);
    expect(() => loadRegistry([e('abc', 1), e('abc', 1)])).toThrow(VersionConflictError);
    expect(() => loadRegistry([e('abc', 2), e('abc', 1)])).toThrow(VersionConflictError);
    expect(() => loadRegistry([e('abc', 2)])).toThrow(VersionConflictError);
    expect(() => loadRegistry([e('abc', 1), e('abd', 1), e('abc', 2)])).not.toThrow();
    expect(() => loadRegistry([{ ...e('abc', 1), payloadSha256: 'zz' }])).toThrow(/registry_invalid/);
    expect(() => loadRegistry([{ ...e('Ab', 1) }])).toThrow(/registry_invalid/);
  });
  it('build and runtime agree: the generated Registry.js replays into a valid registry', () => {
    const store = newStore();
    store.publish(withVersion('valid-v1', 1));
    store.publish(withVersion('valid-v1', 2));
    const js = store.toRegistryJs();
    expect(js).toBe(store.toRegistryJs());
    expect(js.includes('\r')).toBe(false);
    const rows = new Function(`${js}; return REGISTRY_ENTRIES;`)() as RegistryEntry[];
    expect(rows).toEqual(store.entries());
    expect(() => createBuildStore({ digest, tenantId: 'airbus', pins: PINS, validate, initial: [rows[1]] })).toThrow(VersionConflictError);
  });
});

describe('URL scheme ?a=<id>&v=<n> and tenant isolation', () => {
  const store = newStore();
  store.publish(withVersion('valid-v1', 1));
  store.publish(withVersion('valid-v1', 2));
  const reg = store.registry();
  const id = fixture('valid-v1').artifact.id;
  it('latest when v is absent, exact otherwise', () => {
    expect(reg.resolve('airbus', { a: id })?.version).toBe(2);
    expect(reg.resolve('airbus', { a: id, v: '1' })?.version).toBe(1);
  });
  it.each([['0'], ['03'], ['-1'], ['1e2'], ['9999999999'], ['3'], [1]])('v=%s is not found', (v) => {
    expect(reg.resolve('airbus', { a: id, v })).toBeNull();
  });
  it('bad ids and other tenants are indistinguishable from unknown ids', () => {
    expect(reg.resolve('airbus', { a: 'Bad_Id' })).toBeNull();
    expect(reg.resolve('airbus', { a: ['x'] })).toBeNull();
    expect(reg.resolve('other', { a: id })).toBeNull();
    expect(reg.list('other')).toEqual([]);
    expect(reg.list('airbus').length).toBe(2);
  });
});

describe('registry inside the bundle (runtime load, no Promise/TextEncoder/crypto)', () => {
  it('the IIFE exposes loadRegistry with the same predicate', async () => {
    // @ts-expect-error plain .mjs build script
    const { buildGas } = await import('../../scripts/build-gas.mjs');
    const { loadBundle, mockLock, mockProperties } = await import('./harness.js');
    const built = await buildGas({ gitSha: 'test' });
    const { api } = loadBundle(built.code, { Utilities: mockUtilities(), PropertiesService: { getScriptProperties: () => mockProperties() }, LockService: mockLock().service });
    const row = (version: number) => ({ id: 'abc', version, tenantId: 't', file: 'f', title: 't', createdAt: 'x', payloadSha256: 'a'.repeat(64), bytes: 1 });
    expect(api.loadRegistry([row(1), row(2)]).latest('t', 'abc').version).toBe(2);
    expect(() => api.loadRegistry([row(1), row(3)])).toThrow(/version_conflict/);
  });
});
