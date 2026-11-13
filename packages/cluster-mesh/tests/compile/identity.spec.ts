import { describe, expect, it } from 'vitest';
import { COMPILE_CONFORMANCE_RECIPE, compileRecipeKey, validateCompileRecipe, matchesCompileSchema,
  COMPILE_OPTIONS_SCHEMA } from '../../src/compile/contract/index.js';

const recipe = () => structuredClone(COMPILE_CONFORMANCE_RECIPE);
describe('closed recipe identity', () => {
  it.each([
    (r: ReturnType<typeof recipe>) => { r.importMapManifestDigest = 'a'.repeat(64); },
    r => { r.catalogDigest = 'a'.repeat(64); },
    r => { r.compilers[0]!.sha256 = 'a'.repeat(64); },
    r => { r.compilers[0]!.version = '3.6.0-rc.16'; },
    r => { r.dsTuple[0]!.sha256 = 'a'.repeat(64); },
    r => { r.dependencyLockDigest = 'a'.repeat(64); },
    r => { r.options.sourcemap = true; },
    r => { r.options.urlRewriteMode = 'resolved-url'; },
    r => { r.options.extensions.reverse(); },
    r => { r.options.aliases = [{ kind: 'prefix', from: '$lib', to: 'src/lib' }]; },
    r => { r.options.workspaceMap = { example: { mode: 'source', exports: { '.': 'App.vue' } } }; },
    r => { r.options.workspaceMap = { example: { mode: 'mirror', version: '1.0.0', manifestEntryDigest: 'a'.repeat(64) } }; },
    r => { r.profile = 'browser-vue'; },
    r => { r.accessPartition = 'private-v1:sentropic:workspace:' + 'a'.repeat(64); },
  ])('should change the recipe key for identity mutation %#', mutate => {
    const value = recipe();
    mutate(value);
    expect(compileRecipeKey(value)).not.toBe(compileRecipeKey(recipe()));
  });
  it.each([
    (r: ReturnType<typeof recipe>) => { Object.assign(r, { extra: true }); },
    r => { Object.assign(r.options, { plugins: [] }); },
    r => { Object.assign(r.options, { environment: {} }); },
    r => { Object.assign(r.compilers[0]!, { callback: 'run' }); },
    r => { r.importMapManifestDigest = 'none'; },
    r => { r.catalogDigest = 'SHA256:' + 'a'.repeat(64); },
    r => { r.compilers[0]!.version = '^3.6.0'; },
    r => { r.compilers.push(r.compilers[0]!); },
    r => { r.dsTuple.push(r.dsTuple[0]!); },
    r => { r.entry = 'missing.vue'; },
    r => { r.sources[0]!.bytesBase64 = '/w=='; },
    r => { r.sources[0]!.path = 'e\u0301.vue'; },
    r => { r.options.extensions.push('.ts'); },
    r => { r.options.workspaceMap = { example: { mode: 'source', exports: { '.': 'missing.ts' } } }; },
  ])('should refuse malformed recipe mutation %#', mutate => {
    const value = recipe();
    mutate(value);
    expect(() => validateCompileRecipe(value)).toThrow();
  });
  it('should refuse unknown option fields at every nested level', () => {
    const options = recipe().options;
    expect(matchesCompileSchema(options, COMPILE_OPTIONS_SCHEMA)).toBe(true);
    options.workspaceMap = { example: { mode: 'mirror', version: '1.0.0', manifestEntryDigest: 'a'.repeat(64) } };
    Object.assign(options.workspaceMap.example!, { fallback: 'source' });
    expect(matchesCompileSchema(options, COMPILE_OPTIONS_SCHEMA)).toBe(false);
    expect(matchesCompileSchema({ ...recipe().options, sourcemap: undefined }, COMPILE_OPTIONS_SCHEMA)).toBe(false);
  });
  it('should enforce source file and aggregate byte limits', () => {
    const value = recipe();
    value.sources[0]!.bytesBase64 = btoa('a'.repeat(1048577));
    expect(() => validateCompileRecipe(value)).toThrow('compile_quota_exceeded');
    value.sources = Array.from({ length: 3 }, (_, i) => ({ path: i + '.bin', bytesBase64: btoa('a'.repeat(800000)) }));
    value.entry = '0.bin';
    expect(() => validateCompileRecipe(value)).toThrow('compile_quota_exceeded');
  });
});
