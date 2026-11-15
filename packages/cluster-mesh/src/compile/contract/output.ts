import type { CompileOutputDescriptorV1, CompileOutputManifestV1 } from './types.js';
import { COMPILE_OUTPUT_MANIFEST_SCHEMA, matchesCompileSchema } from './schema.js';
import { CompileContractError, compileCanonicalJson, compileJsonDigest, compileSha256, compileSri, normalizeCompilePath } from './encoding.js';

const refuse = (): never => { throw new CompileContractError('output_manifest_mismatch'); };
export function validateCompileManifest(input: unknown): asserts input is CompileOutputManifestV1 {
  compileCanonicalJson(input);
  if (!matchesCompileSchema(input, COMPILE_OUTPUT_MANIFEST_SCHEMA)) refuse();
  const manifest = input as CompileOutputManifestV1;
  const outputs = new Map<string, CompileOutputDescriptorV1>();
  let total = 0;
  let previous = '';
  for (const output of manifest.outputs) {
    if (output.path !== normalizeCompilePath(output.path) || output.path <= previous) refuse();
    previous = output.path;
    if (output.sri !== compileSri(output.sha256)) refuse();
    if ((total += output.bytes) > 4194304) refuse();
    if (output.path.endsWith('.map') && output.visibility !== 'private') refuse();
    outputs.set(output.path, output);
  }
  const entry = outputs.get(manifest.entry);
  if (!entry || !['text/javascript', 'application/javascript'].includes(entry.mimeType)) refuse();
  if (new Set(manifest.css).size !== manifest.css.length || new Set(manifest.modules).size !== manifest.modules.length) refuse();
  if (!manifest.modules.includes(manifest.entry)) refuse();
  for (const path of manifest.css) if (outputs.get(path)?.mimeType !== 'text/css') refuse();
  previous = '';
  for (const path of manifest.modules) {
    const output = outputs.get(path);
    if (path <= previous || !output || !['text/javascript', 'application/javascript'].includes(output.mimeType)) refuse();
    previous = path;
  }
  previous = '';
  for (const pkg of manifest.dependencies) {
    if (pkg.name <= previous) refuse();
    previous = pkg.name;
  }
}
export function compileManifestDigest(manifest: CompileOutputManifestV1): string {
  validateCompileManifest(manifest);
  return compileJsonDigest(manifest);
}
export function verifyCompileOutput(output: CompileOutputDescriptorV1, bytes: Uint8Array): void {
  if (output.bytes !== bytes.length || compileSha256(bytes) !== output.sha256 || compileSri(output.sha256) !== output.sri) {
    throw new CompileContractError('output_corrupt');
  }
}
