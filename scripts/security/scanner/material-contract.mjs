import { digest } from '../daily/toolchain-contract.mjs';
import { requireContract as check, text, integer, hash, sha, version, path, literal, list,
  record, measured, equal, CONTRACT_ONLY } from './contract-schema.mjs';

const https = value => {
  if (!text(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; }
  catch { return false; }
};
export const upstreamSchema = record({ repository: literal('https://github.com/aquasecurity/trivy'),
  version, commit: sha, archive: path, authentication: list(path),
  authenticationGap: value => typeof value === 'string', licenses: list(path) });
const recipeSchema = record({ schemaVersion: literal(1),
  stages: value => equal(value, ['acquire-upstream', 'apply-patches', 'rebuild', 'layout-sbom', 'validate']),
  sourceCommit: sha, patchRevision: integer, upstream: upstreamSchema, origins: list(https),
  patches: list(record({ path, cve: value => /^CVE-\d{4}-\d{4,}$/.test(value), component: text,
    version: value => typeof value === 'string' && /^v?\d+\.\d+\.\d+(?:-r\d+)?$/.test(value) })),
  go: record({ version, compiler: path, mod: path, sum: path, modules: list(path) }),
  base: record({ repository: value => text(value) && /^[a-z0-9.-]+\/[a-z0-9/._-]+$/.test(value),
    index: path, manifest: path, config: path, layers: list(path), indexes: list(path), packages: list(path) }),
  tools: record({ acquisition: list(path), build: list(path), sbom: list(path) }),
  actions: list(record({ repository: value => typeof value === 'string' && /^[\w-]+\/[\w-]+$/.test(value), commit: sha })),
});
const materialSchema = record({ path, kind: text, url: https, digest: hash, size: integer });
const manifestSchema = record({ schemaVersion: literal(1), recipeDigest: hash, materials: list(materialSchema) });

// Validates declared contracts and retained bytes only. Authentication, tool/content
// admission and actual execution remain separate r6 gates; this function grants none.
export function validateMaterialInventory({ recipeBytes, manifest } = {}) {
  check(Buffer.isBuffer(recipeBytes) && recipeBytes.length > 0, 'recipe bytes');
  let recipe;
  try { recipe = JSON.parse(recipeBytes); } catch { check(false, 'recipe JSON'); }
  check(recipeSchema(recipe), 'recipe schema/pins');
  check(manifestSchema(manifest), 'material schema/pins');
  check(manifest.recipeDigest === digest(recipeBytes), 'recipe digest');
  const expected = [
    [recipe.upstream.archive, 'upstream-source'],
    ...recipe.upstream.authentication.map(p => [p, 'authentication']),
    ...recipe.upstream.licenses.map(p => [p, 'license']),
    ...recipe.patches.map(p => [p.path, 'patch']),
    [recipe.go.compiler, 'compiler'], [recipe.go.mod, 'go-mod'], [recipe.go.sum, 'go-sum'],
    ...recipe.go.modules.map(p => [p, 'go-module']),
    [recipe.base.index, 'base-index'], [recipe.base.manifest, 'base-manifest'], [recipe.base.config, 'base-config'],
    ...recipe.base.layers.map(p => [p, 'base-layer']), ...recipe.base.indexes.map(p => [p, 'os-package-index']),
    ...recipe.base.packages.map(p => [p, 'os-package']),
    ...recipe.tools.acquisition.map(p => [p, 'acquisition-tool']), ...recipe.tools.build.map(p => [p, 'build-tool']),
    ...recipe.tools.sbom.map(p => [p, 'sbom-tool']),
  ];
  check(new Set(expected.map(([p]) => p)).size === expected.length, 'unique material references');
  check(equal(expected, manifest.materials.map(m => [m.path, m.kind])), 'ordered material inventory');
  for (const material of manifest.materials) {
    check(recipe.origins.includes(new URL(material.url).origin), 'material origin');
  }
  return recipe;
}

export function validateMaterialContract({ recipeBytes, manifest, files } = {}) {
  validateMaterialInventory({ recipeBytes, manifest });
  check(files && equal(Object.keys(files).sort(), manifest.materials.map(m => m.path).sort()), 'complete retained materials');
  for (const material of manifest.materials) measured(material, files);
  return CONTRACT_ONLY;
}
