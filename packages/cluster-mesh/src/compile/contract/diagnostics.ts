import type { CompileDiagnosticCodeV1, CompileDiagnosticV1, CompileResultV1 } from './types.js';
import { COMPILE_DIAGNOSTIC_CODES, COMPILE_DIAGNOSTIC_STAGES } from './types.js';
import { COMPILE_DIAGNOSTIC_SCHEMA, COMPILE_OUTPUT_DESCRIPTOR_SCHEMA, COMPILE_OUTPUT_MANIFEST_SCHEMA,
  closed, matchesCompileSchema } from './schema.js';
import { CompileContractError, compileCanonicalJson } from './encoding.js';
import { compileManifestDigest } from './output.js';

const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const diagnostics = { type: 'array', items: COMPILE_DIAGNOSTIC_SCHEMA, maxItems: 50 } as const;
export const COMPILE_RESULT_SCHEMA = { oneOf: [
  closed({ apiVersion: { const: 1 }, status: { const: 'ok' }, digest: hash, manifestDigest: hash,
    manifest: COMPILE_OUTPUT_MANIFEST_SCHEMA, module: COMPILE_OUTPUT_DESCRIPTOR_SCHEMA,
    css: { type: 'array', items: COMPILE_OUTPUT_DESCRIPTOR_SCHEMA, maxItems: 64 }, diagnostics }),
  closed({ apiVersion: { const: 1 }, status: { const: 'refused' },
    code: { enum: COMPILE_DIAGNOSTIC_CODES.filter(code => code !== 'diagnostics_truncated') },
    diagnostics: { ...diagnostics, minItems: 1 } }),
] } as const;
/** Never copy native exception messages or source excerpts across the wire. */
export function compileDiagnostic(code: CompileDiagnosticCodeV1,
  stage: CompileDiagnosticV1['stage'], severity: CompileDiagnosticV1['severity'] = 'error'): CompileDiagnosticV1 {
  return { code, stage, severity: code === 'diagnostics_truncated' ? 'warning' : severity,
    message: code.replaceAll('_', ' ') };
}
export function limitCompileDiagnostics(input: readonly CompileDiagnosticV1[]): CompileDiagnosticV1[] {
  const sorted = input.filter(d => d.code !== 'diagnostics_truncated').map(d => ({
    ...d, message: d.code.replaceAll('_', ' '),
  })).sort((a, b) => COMPILE_DIAGNOSTIC_STAGES.indexOf(a.stage) - COMPILE_DIAGNOSTIC_STAGES.indexOf(b.stage));
  if (sorted.length <= 50 && !input.some(d => d.code === 'diagnostics_truncated')) return sorted;
  const kept = sorted.slice(0, 49);
  const firstError = sorted.find(d => d.severity === 'error');
  if (firstError && !kept.includes(firstError)) {
    kept[48] = firstError;
    kept.sort((a, b) => COMPILE_DIAGNOSTIC_STAGES.indexOf(a.stage) - COMPILE_DIAGNOSTIC_STAGES.indexOf(b.stage));
  }
  kept.push(compileDiagnostic('diagnostics_truncated', 'cleanup', 'warning'));
  return kept;
}
export function validateCompileResult(input: unknown): asserts input is CompileResultV1 {
  compileCanonicalJson(input);
  const fail = (): never => { throw new CompileContractError('output_manifest_mismatch'); };
  if (!matchesCompileSchema(input, COMPILE_RESULT_SCHEMA)) fail();
  const result = input as CompileResultV1;
  let stageIndex = -1;
  for (const [index, diagnostic] of result.diagnostics.entries()) {
    const current = COMPILE_DIAGNOSTIC_STAGES.indexOf(diagnostic.stage);
    if (current < stageIndex || (diagnostic.range && diagnostic.range.start > diagnostic.range.end)) fail();
    stageIndex = current;
    if (diagnostic.code === 'diagnostics_truncated' && (diagnostic.severity !== 'warning'
      || index !== result.diagnostics.length - 1)) fail();
  }
  const firstError = result.diagnostics.find(d => d.severity === 'error');
  if (result.status === 'refused') {
    if (!firstError || firstError.code !== result.code) fail();
    return;
  }
  if (firstError || result.digest !== result.manifest.recipeKey
    || compileManifestDigest(result.manifest) !== result.manifestDigest) fail();
  const entry = result.manifest.outputs.find(output => output.path === result.manifest.entry);
  if (compileCanonicalJson(result.module) !== compileCanonicalJson(entry)) fail();
  const css = result.manifest.css.map(path => result.manifest.outputs.find(output => output.path === path));
  if (compileCanonicalJson(result.css) !== compileCanonicalJson(css)) fail();
}
