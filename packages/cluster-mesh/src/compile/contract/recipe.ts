import type { CompileRecipeV1 } from './types.js';
import { COMPILE_RECIPE_DOMAIN } from './types.js';
import { EXECUTION_NODE_V1_COMPILE_RECIPE_SCHEMA, matchesCompileSchema } from './schema.js';
import { CompileContractError, compileCanonicalJson, compileDecodeBase64, compileSha256, normalizeCompilePath } from './encoding.js';

const refuse = (code: string): never => { throw new CompileContractError(code); };
function sortedUnique(values: string[], code: string): void {
  if (values.some((value, i) => i > 0 && values[i - 1]! >= value)) refuse(code);
}
function canonicalPaths(paths: string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    const normalized = normalizeCompilePath(path);
    if (seen.has(normalized)) refuse('duplicate_normalized_path');
    seen.add(normalized);
  }
  if (paths.some(path => path !== normalizeCompilePath(path))) refuse('invalid_source_path');
}
/** Host authority, grants and compiler integrity require separate admission, never recipe claims. */
export function validateCompileRecipe(input: unknown): asserts input is CompileRecipeV1 {
  compileCanonicalJson(input);
  if (!matchesCompileSchema(input, EXECUTION_NODE_V1_COMPILE_RECIPE_SCHEMA)) refuse('invalid_recipe');
  const recipe = input as CompileRecipeV1;
  const paths = recipe.sources.map(source => source.path);
  canonicalPaths(paths);
  sortedUnique(paths, 'invalid_recipe');
  if (!paths.includes(recipe.entry)) refuse('invalid_source_path');
  let total = 0;
  for (const source of recipe.sources) {
    const bytes = compileDecodeBase64(source.bytesBase64);
    if (bytes.length > 1048576 || (total += bytes.length) > 2097152) refuse('compile_quota_exceeded');
    // Text sources are exact UTF-8; binary assets remain opaque bytes.
    if (/\.(?:vue|[cm]?[jt]s|css|json)$/u.test(source.path)) {
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { refuse('invalid_recipe'); }
    }
  }
  const roles = recipe.compilers.map(compiler => compiler.role);
  if (new Set(roles).size !== roles.length) refuse('invalid_recipe');
  sortedUnique(recipe.dsTuple.map(pkg => pkg.name), 'invalid_recipe');
  const options = recipe.options;
  if (new Set(options.extensions).size !== options.extensions.length) refuse('invalid_recipe_option');
  const aliases = new Set<string>();
  for (const alias of options.aliases) {
    const key = alias.kind + ':' + alias.from + ':' + (alias.kind === 'replacement' ? alias.profile : '');
    if (aliases.has(key)) refuse('invalid_recipe_option');
    aliases.add(key);
    normalizeCompilePath(alias.to);
    if (alias.to !== normalizeCompilePath(alias.to)) refuse('invalid_recipe_option');
  }
  for (const [name, workspace] of Object.entries(options.workspaceMap)) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(name)) refuse('invalid_recipe_option');
    if (workspace.mode === 'source') {
      if (Object.keys(workspace.exports).length === 0) refuse('invalid_recipe_option');
      for (const [subpath, target] of Object.entries(workspace.exports)) {
        if (subpath !== '.' && (!subpath.startsWith('./') || subpath.includes('*'))) refuse('invalid_recipe_option');
        if (subpath !== '.') normalizeCompilePath(subpath.slice(2));
        if (target !== normalizeCompilePath(target)) refuse('invalid_recipe_option');
        if (!paths.includes(target)) refuse('workspace_unresolved');
      }
    }
  }
}
export function compileRecipeKey(recipe: CompileRecipeV1): string {
  validateCompileRecipe(recipe);
  return compileSha256(new TextEncoder().encode(COMPILE_RECIPE_DOMAIN + compileCanonicalJson(recipe)));
}
