import { describe, expect, it } from 'vitest';
import { COMPILE_CONFORMANCE_RECIPE, compileCanonicalJson, compileRecipeKey,
  validateCompileRecipe } from '../../src/compile/contract/index.js';

describe('compile identity accepts only plain JSON data', () => {
  it('should refuse hidden required fields rather than omit their identity', () => {
    for (const digest of ['a'.repeat(64), 'b'.repeat(64)]) {
      const recipe = structuredClone(COMPILE_CONFORMANCE_RECIPE);
      Object.defineProperty(recipe, 'catalogDigest', { value: digest, enumerable: false });
      expect(() => validateCompileRecipe(recipe)).toThrow('invalid_recipe');
      expect(() => compileRecipeKey(recipe)).toThrow('invalid_recipe');
    }
  });
  it('should refuse sparse arrays even when an extra key compensates for a hole', () => {
    const recipe = structuredClone(COMPILE_CONFORMANCE_RECIPE);
    const extensions = new Array<string>(2);
    extensions[1] = '.ts';
    Object.assign(extensions, { extra: true });
    recipe.options.extensions = extensions;
    expect(() => compileCanonicalJson(extensions)).toThrow('invalid_recipe');
    expect(() => compileRecipeKey(recipe)).toThrow('invalid_recipe');
  });
  it('should refuse array accessors, symbols and hidden indices without invoking code', () => {
    const accessor = ['.ts'];
    Object.defineProperty(accessor, '0', { get() { throw new Error('accessor executed'); } });
    const symbol = ['.ts'];
    Object.defineProperty(symbol, Symbol('hidden'), { value: 1 });
    const hidden = ['.ts'];
    Object.defineProperty(hidden, '0', { enumerable: false });
    for (const array of [accessor, symbol, hidden]) {
      expect(() => compileCanonicalJson(array)).toThrow('invalid_recipe');
    }
  });
});
