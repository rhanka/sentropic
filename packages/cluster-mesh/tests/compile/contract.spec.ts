import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as contract from '../../src/compile/contract/index.js';
import { COMPILE_CONFORMANCE_RECIPE as fixture, COMPILE_CONFORMANCE_VECTORS as vectors } from '../../src/compile/contract/vectors.js';

const recipe = () => structuredClone(fixture);
const nativeHash = (value: string) => createHash('sha256').update(value).digest('hex');
describe('AMD-ISO shared compile contract', () => {
  it('should preserve execution-node.v1 definitions and declare the matching compile-only profile', async () => {
    const canonical = await import('../../../../apps/sandbox-node/src/contract.js');
    expect(canonical.EXECUTION_NODE_CONTRACT_VERSION).toBe('execution-node.v1');
    expect(canonical.EXECUTION_NODE_V1_AMD_ISO.profile).toBe(contract.COMPILE_ISOLATE_PROFILE);
    expect(canonical.EXECUTION_NODE_V1_AMD_ISO.apiVersion).toBe(contract.COMPILE_API_VERSION);
    expect(canonical.EXECUTION_NODE_V1_AMD_ISO.executesUserCode).toBe(false);
    const text = readFileSync(new URL('../../../../apps/sandbox-node/src/contract.ts', import.meta.url), 'utf8');
    expect(text).toContain("readonly classes: readonly ['sandbox'];");
    expect(text).toContain("schemaVersion: 'ds-recipe-key.v1';");
    expect(text).toContain('`sha256:${string}` | \'none\'');
  });
  it.each(vectors.jcs)('should canonicalize the shared JCS vector %#', ({ input, expected }) => {
    expect(contract.compileCanonicalJson(input)).toBe(expected);
  });
  it.each(vectors.sha256)('should hash the standard SHA-256 vector %#', ({ text, expected }) => {
    expect(contract.compileSha256(new TextEncoder().encode(text))).toBe(expected);
  });
  it('should produce one domain-separated recipe key regardless of object insertion order', () => {
    const value = recipe();
    const canonical = contract.compileCanonicalJson(value);
    const expected = nativeHash('h2a.vue.compile.recipe@1\n' + canonical);
    expect(contract.compileRecipeKey(value)).toBe(expected);
    expect(expected).toBe(contract.COMPILE_CONFORMANCE_RECIPE_KEY);
    expect(contract.compileRecipeKey(JSON.parse(canonical))).toBe(expected);
    expect(expected).not.toBe(nativeHash(canonical));
  });
  it.each(vectors.invalidPaths)('should refuse invalid path %j', path => {
    expect(() => contract.normalizeCompilePath(path)).toThrow();
  });
  it.each(vectors.invalidBase64)('should refuse noncanonical base64 %j', value => {
    expect(() => contract.compileDecodeBase64(value)).toThrow();
  });
  it.each(vectors.invalidJson)('should refuse ambiguous or invalid JSON %j', value => {
    expect(() => contract.parseCompileJson(value)).toThrow();
  });
  it('should refuse Unicode path collisions before normalization can erase evidence', () => {
    const value = recipe();
    value.sources = [{ path: 'é.vue', bytesBase64: '' }, { path: 'e\u0301.vue', bytesBase64: '' }];
    expect(() => contract.validateCompileRecipe(value)).toThrow('duplicate_normalized_path');
  });
  it('should reject non-I-JSON values and preserve exact source bytes', () => {
    for (const invalid of [NaN, Infinity, undefined, { a: undefined }, '\ud800', new Date(), [, 1]]) {
      expect(() => contract.compileCanonicalJson(invalid)).toThrow();
    }
    const value = recipe();
    const previous = contract.compileRecipeKey(value);
    value.sources[0]!.bytesBase64 = btoa('<template>Hello</template>\r\n');
    expect(contract.compileRecipeKey(value)).not.toBe(previous);
    expect(contract.parseCompileJson('{"__proto__":{"a":1}}')).toEqual({ ['__proto__']: { a: 1 } });
  });
});
