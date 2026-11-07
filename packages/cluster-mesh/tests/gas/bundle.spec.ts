import { createHash, randomBytes } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script
import { buildGas, FORBIDDEN_INPUTS, HARD_BUDGET_BYTES, SOFT_BUDGET_BYTES } from '../../scripts/build-gas.mjs';
import { loadBundle, mockLock, mockProperties, mockUtilities } from './harness.js';

const built = await buildGas({ gitSha: 'test' });
const env = () => ({ Utilities: mockUtilities(), PropertiesService: { getScriptProperties: () => mockProperties() }, LockService: mockLock().service });

describe('GAS bundle (G1)', () => {
  it('A1 loads in a vm context with only mocked globals (no Promise/TextEncoder/crypto) and a fetch call fails', () => {
    const { ctx, api } = loadBundle(built.code, env());
    expect(Object.keys(api)).toEqual(expect.arrayContaining(['probe', 'createGasViewerIdentity', 'createDossierAccess']));
    expect(() => api.init(env(), { mode: 'store' })).not.toThrow();
    expect(() => vm.runInContext('UrlFetchApp.fetch("https://example.invalid")', ctx)).toThrow(/UrlFetchApp is not defined/);
  });
  it('A2 static gate: no node: specifier, require(, dynamic import(, ESM statements, eval, new Function', () => {
    const body = built.code.replace(/^\/\*.*?\*\/\n?/, '');
    for (const re of [/\bnode:/, /\brequire\s*\(/, /\bimport\s*\(/, /^\s*(import|export)\s/m, /\beval\s*\(/, /\bnew\s+Function\b/, /\bawait\b/, /\basync\b/, /\bPromise\b/, /\bTextEncoder\b/, /\bcrypto\b/])
      expect(re.test(body), String(re)).toBe(false);
    expect(built.inputs.filter((i: string) => FORBIDDEN_INPUTS.some((re: RegExp) => re.test(i)))).toEqual([]);
    expect(built.inputs.every((i: string) => i.startsWith('src/'))).toBe(true);
  });
  it('A6(i) DigestPort over computeDigest equals node:crypto incl. non-ASCII, multi-byte and number[] inputs', () => {
    const { api } = loadBundle(built.code, env());
    const digest = api.init(env(), { mode: 'registry' }).digest;
    for (const s of ['', 'abc', 'é', '中文', '😀', 'a\u{1F600}bé', 'ws:x', 'lone\ud800']) {
      const expected = createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
      expect(api.sha256Utf8(digest, s)).toBe(expected);
    }
    for (let i = 0; i < 50; i++) {
      const b = randomBytes(1 + (i * 7) % 300);
      expect(digest.sha256Bytes(Array.from(b))).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });
  it('A7 determinism: two builds give identical sha256', async () => {
    const again = await buildGas({ gitSha: 'test' });
    expect(again.sha256).toBe(built.sha256);
    expect(createHash('sha256').update(built.code).digest('hex')).toBe(built.sha256);
    expect(built.code.includes('\r')).toBe(false);
    console.log(`GAS_BUNDLE_SHA256=${built.sha256} SIZE=${built.size}`);
  });
  it('A8 size gate', () => {
    expect(built.size).toBeLessThanOrEqual(SOFT_BUDGET_BYTES);
    expect(built.size).toBeLessThan(HARD_BUDGET_BYTES);
  });
});

