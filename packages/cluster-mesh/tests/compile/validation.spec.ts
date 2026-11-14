import { describe, expect, it } from 'vitest';
import { COMPILE_CONFORMANCE_RECIPE, COMPILE_CONFORMANCE_VECTORS, compileDiagnostic, limitCompileDiagnostics,
  validateCompileRecipe, validateCompileResult } from '../../src/compile/contract/index.js';

describe('compile source and diagnostic boundaries', () => {
  it.each(COMPILE_CONFORMANCE_VECTORS.invalidSourcePaths)
  ('should refuse source paths outside the v1 ASCII profile: %s', path => {
    const recipe = structuredClone(COMPILE_CONFORMANCE_RECIPE);
    recipe.sources[0]!.path = path;
    recipe.entry = path;
    expect(() => validateCompileRecipe(recipe)).toThrow('invalid_source_path');
  });
  it.each(['template.html', 'template'])('should require UTF-8 entry bytes for %s', path => {
    const recipe = structuredClone(COMPILE_CONFORMANCE_RECIPE);
    recipe.kind = 'vue-template';
    recipe.entry = path;
    recipe.sources = [{ path, bytesBase64: '/w==' }];
    expect(() => validateCompileRecipe(recipe)).toThrow('invalid_recipe');
  });
  it('should preserve opaque binary assets beside a valid text entry', () => {
    const recipe = structuredClone(COMPILE_CONFORMANCE_RECIPE);
    recipe.sources.push({ path: 'asset.bin', bytesBase64: '/w==' });
    expect(() => validateCompileRecipe(recipe)).not.toThrow();
  });
  it.each(['/outside/App.vue', '../App.vue', 'a\\b.vue', 'e\u0301.vue'])
  ('should refuse noncanonical diagnostic paths: %s', path => {
    const diagnostic = { ...compileDiagnostic('compiler_failed', 'transform'), path };
    const result = { apiVersion: 1, status: 'refused', code: 'compiler_failed', diagnostics: [diagnostic] };
    expect(() => validateCompileResult(result)).toThrow('output_manifest_mismatch');
    expect(() => limitCompileDiagnostics([diagnostic])).toThrow('output_manifest_mismatch');
  });
  it('should refuse raw messages and sanitize messages through the limiter', () => {
    const diagnostic = { ...compileDiagnostic('compiler_failed', 'transform'),
      message: 'const internalValue = 42;', path: 'src/App.vue', range: { start: 1, end: 2 } };
    const result = { apiVersion: 1, status: 'refused', code: 'compiler_failed', diagnostics: [diagnostic] };
    expect(() => validateCompileResult(result)).toThrow('output_manifest_mismatch');
    const diagnostics = limitCompileDiagnostics([diagnostic]);
    expect(diagnostics[0]).toEqual({ ...diagnostic, message: 'compiler failed' });
    expect(() => validateCompileResult({ ...result, diagnostics })).not.toThrow();
  });
});
