// Synthetic data for contract tests only; this is never an admission receipt.
import { digest } from '../daily/toolchain-contract.mjs';
export const commit = 'a'.repeat(40);
export function materialFixture() {
  const files = {};
  const materials = [];
  const add = (path, kind, bytes = `synthetic ${path}`) => {
    files[path] = Buffer.from(bytes);
    materials.push({ path, kind, url: `https://github.com/aquasecurity/trivy/${path}`,
      digest: digest(files[path]), size: files[path].length });
    return path;
  };
  const recipe = {
    schemaVersion: 1, stages: ['acquire-upstream', 'apply-patches', 'rebuild', 'layout-sbom', 'validate'],
    sourceCommit: commit, patchRevision: 1,
    upstream: { repository: 'https://github.com/aquasecurity/trivy', version: '0.76.1', commit,
      archive: add('source.tar', 'upstream-source'), authentication: [add('source.bundle', 'authentication')],
      authenticationGap: '', licenses: [add('LICENSE', 'license')] },
    origins: ['https://github.com'],
    patches: [
      { path: add('brotli.patch', 'patch'), cve: 'CVE-2026-111497', component: 'brotli-libs', version: '1.2.1-r0' },
      { path: add('curl.patch', 'patch'), cve: 'CVE-2026-92392', component: 'libcurl', version: '8.23.0-r0' },
      { path: add('jose.patch', 'patch'), cve: 'CVE-2026-116587', component: 'github.com/go-jose/go-jose/v4', version: 'v4.1.6' },
    ],
    go: { version: '1.26.1', compiler: add('go.tar', 'compiler'), mod: add('go.mod', 'go-mod'),
      sum: add('go.sum', 'go-sum'), modules: [add('jose.zip', 'go-module')] },
    base: { repository: 'ghcr.io/example/base', index: add('index.json', 'base-index'),
      manifest: add('manifest.json', 'base-manifest'), config: add('config.json', 'base-config'),
      layers: [add('base.tar', 'base-layer')], indexes: [add('APKINDEX.tar.gz', 'os-package-index')],
      packages: [add('brotli.apk', 'os-package'), add('curl.apk', 'os-package')] },
    tools: { acquisition: [add('acquire', 'acquisition-tool')], build: [add('build', 'build-tool')],
      sbom: [add('sbom', 'sbom-tool')] },
    actions: [{ repository: 'actions/checkout', commit }],
  };
  const recipeBytes = Buffer.from(JSON.stringify(recipe));
  return { recipeBytes, manifest: { schemaVersion: 1, recipeDigest: digest(recipeBytes), materials }, files };
}
