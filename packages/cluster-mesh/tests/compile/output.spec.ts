import { describe, expect, it } from 'vitest';
import { COMPILE_DIAGNOSTIC_CODES, COMPILE_DIAGNOSTIC_STAGES, COMPILE_DIAGNOSTIC_SCHEMA,
  compileDiagnostic, matchesCompileSchema, compileJsonDigest, compileManifestDigest, compileRecipeKey,
  COMPILE_CONFORMANCE_RECIPE, compileSha256, compileSri, verifyCompileOutput,
  limitCompileDiagnostics, validateCompileResult, validateCompileManifest } from '../../src/compile/contract/index.js';
import type { CompileOutputManifestV1, CompileResultV1 } from '../../src/compile/contract/index.js';

const bytes = new TextEncoder().encode('export default 1;');
const digest = compileSha256(bytes);
const output = { path: 'App.js', sha256: digest, bytes: bytes.length, mimeType: 'text/javascript',
  sri: compileSri(digest), visibility: 'public' as const };
const manifest = (): CompileOutputManifestV1 => ({ apiVersion: 1,
  recipeKey: compileRecipeKey(COMPILE_CONFORMANCE_RECIPE), entry: output.path, css: [],
  outputs: [{ ...output }], modules: [output.path], dependencies: [], notices: [] });
const success = (): CompileResultV1 => { const value = manifest(); return { apiVersion: 1, status: 'ok',
  digest: value.recipeKey, manifestDigest: compileManifestDigest(value), manifest: value,
  module: { ...output }, css: [], diagnostics: [] }; };
describe('compile output and diagnostic conformance', () => {
  it('should separate recipe, manifest and file identity and verify exact bytes and SRI', () => {
    const value = manifest();
    expect(compileManifestDigest(value)).toBe(compileJsonDigest(value));
    expect(compileManifestDigest(value)).not.toBe(value.recipeKey);
    expect(compileManifestDigest(value)).not.toBe(digest);
    expect(() => verifyCompileOutput(output, bytes)).not.toThrow();
    expect(() => verifyCompileOutput(output, new Uint8Array([0]))).toThrow('output_corrupt');
    expect(() => validateCompileResult(success())).not.toThrow();
  });
  it.each(['hash', 'sri', 'entry', 'duplicate', 'css', 'private-map'])('should refuse manifest corruption %s', kind => {
    const value = manifest();
    if (kind === 'hash') value.outputs[0]!.sha256 = 'a'.repeat(64);
    if (kind === 'sri') value.outputs[0]!.sri = compileSri('a'.repeat(64));
    if (kind === 'entry') value.entry = 'missing.js';
    if (kind === 'duplicate') value.outputs.push(value.outputs[0]!);
    if (kind === 'css') value.css = ['missing.css'];
    if (kind === 'private-map') value.outputs.push({ ...output, path: 'App.map' });
    expect(() => validateCompileManifest(value)).toThrow();
  });
  it.each(COMPILE_DIAGNOSTIC_CODES)('should use the common schema for diagnostic %s', code => {
    const diagnostic = compileDiagnostic(code, 'admission');
    expect(matchesCompileSchema(diagnostic, COMPILE_DIAGNOSTIC_SCHEMA)).toBe(true);
    if (code === 'diagnostics_truncated') expect(diagnostic.severity).toBe('warning');
    else expect(() => validateCompileResult({ apiVersion: 1, status: 'refused', code, diagnostics: [diagnostic] })).not.toThrow();
  });
  it('should keep the first error when truncating and never return partial output on refusal', () => {
    const input = Array.from({ length: 55 }, () => compileDiagnostic('unsupported_import', 'resolve', 'warning'));
    input.push(compileDiagnostic('compiler_failed', 'transform'));
    const limited = limitCompileDiagnostics(input);
    expect(limited).toHaveLength(50);
    expect(limited[49]!.code).toBe('diagnostics_truncated');
    expect(limited.find(d => d.severity === 'error')!.code).toBe('compiler_failed');
    const refused = { apiVersion: 1, status: 'refused', code: 'compiler_failed', diagnostics: limited };
    expect(() => validateCompileResult(refused)).not.toThrow();
    expect(() => validateCompileResult({ ...refused, module: output })).toThrow();
    expect(() => validateCompileResult({ ...refused, code: 'compile_cancelled' })).toThrow();
    expect(limited.map(d => COMPILE_DIAGNOSTIC_STAGES.indexOf(d.stage))).toEqual(
      limited.map(d => COMPILE_DIAGNOSTIC_STAGES.indexOf(d.stage)).sort((a, b) => a - b));
  });
  it('should reject success responses with a foreign manifest or descriptor', () => {
    const value = success();
    if (value.status !== 'ok') throw new Error('fixture');
    value.manifestDigest = 'a'.repeat(64);
    expect(() => validateCompileResult(value)).toThrow();
    const other = success();
    if (other.status !== 'ok') throw new Error('fixture');
    other.module = { ...output, bytes: 0 };
    expect(() => validateCompileResult(other)).toThrow();
  });
});
