// Synthetic contract data, never a trusted platform or runtime-admission proof.
import { digest } from '../daily/toolchain-contract.mjs';
import { materialFixture, commit } from './contract-fixture.mjs';
export function receiptFixture() {
  const materials = materialFixture();
  const outputs = {};
  const file = (path, content) => {
    outputs[path] = Buffer.from(content);
    return { path, digest: digest(outputs[path]), size: outputs[path].length };
  };
  const binary = file('trivy', 'synthetic binary');
  const sbom = file('sbom.json', '{"components":["synthetic"]}');
  const layer = file('layer.tar', 'synthetic layer');
  const config = file('config.json', JSON.stringify({ os: 'linux', architecture: 'amd64' }));
  const manifest = file('manifest.json', JSON.stringify({ config, layers: [layer] }));
  const index = file('index.json', JSON.stringify({ manifests: [{ ...manifest,
    platform: { os: 'linux', architecture: 'amd64' } }] }));
  const artifactBytes = Buffer.from('synthetic archive: transport qualification belongs to A07');
  const artifact = { id: 42, digest: digest(artifactBytes), size: artifactBytes.length,
    retentionDays: 90, files: [index, manifest, config, layer, binary, sbom] };
  const chain = { index, manifest, config, layers: [layer], binary, sbom, platform: 'linux/amd64' };
  const base = {
    schemaVersion: 1, repository: 'rhanka/sentropic', repositoryId: 123, lot: 'ACT-L02',
    acceptanceIds: ['T6-S1'], head: commit, base: commit, tree: commit, sourceCommit: commit,
    workflow: { path: '.github/workflows/security-scanner-image.yml', commit },
    controlDigest: digest('control'), policyDigest: digest('policy'), schemaDigest: digest('schema'),
    materialDigest: digest(JSON.stringify(materials.manifest)), recipeDigest: materials.manifest.recipeDigest,
    runId: 12, attempt: 1, actor: 'synthetic-actor',
    startedAt: '2026-11-02T10:00:00Z', finishedAt: '2026-11-02T10:01:00Z',
    outcome: 'success', failures: [], skips: [], commands: ['synthetic-command --fixed-option'],
    review: { identity: 'synthetic-reviewer', model: 'synthetic-other-model',
      disposition: 'approved', digest: digest('review') }, artifact, chain,
  };
  const normalized = { filesystemDigest: digest('filesystem'), binaryDigest: binary.digest,
    dependenciesDigest: digest('dependencies') };
  const recipe = JSON.parse(materials.recipeBytes);
  const build = { ...structuredClone(base), type: 'ScannerImageBuildReceiptV1', job: 'build-scanner-image',
    upstream: recipe.upstream, patchDigests: materials.manifest.materials.filter(m => m.kind === 'patch').map(m => m.digest),
    toolsDigest: digest(JSON.stringify({ go: recipe.go, base: recipe.base, tools: recipe.tools, actions: recipe.actions })),
    isolation: { platform: 'linux/amd64', network: 'disabled', credentials: false,
      sharedDaemon: false, canaryDigest: digest('canary') },
    reproducibility: { first: normalized, second: structuredClone(normalized), allowedDifferences: [] } };
  const validation = { ...structuredClone(base), type: 'ScannerImageValidationReceiptV1', job: 'verify-scanner-image-publication',
    buildReceiptDigest: digest(JSON.stringify(build)), validatorToolsDigest: digest('validator'),
    checks: { content: true, reproducibility: true, selfSca: true, positiveControls: true,
      noExecution: true, noSecrets: true }, independentReviews: [digest('independent-review')],
    expiresAt: '2026-11-03T10:00:00Z', publicationEligible: true };
  const publication = { ...structuredClone(base), type: 'ScannerImagePublicationReceiptV1', job: 'publish-scanner-image',
    buildReceiptDigest: digest(JSON.stringify(build)), validationReceiptDigest: digest(JSON.stringify(validation)),
    package: 'ghcr.io/rhanka/sentropic-trivy', environment: { name: 'security-scanner-image-publish', protectionDigest: digest('protection') },
    permissions: { requested: { packages: 'write', actions: 'read', 'id-token': 'write' },
      granted: { packages: 'write', actions: 'read', 'id-token': 'write' } },
    reachablePackages: ['ghcr.io/rhanka/sentropic-trivy'], visibility: 'public', repositoryLink: 'rhanka/sentropic',
    registryReadbackDigest: index.digest, anonymousPullDigest: index.digest,
    signing: { issuer: 'https://token.actions.githubusercontent.com',
      identity: 'https://github.com/rhanka/sentropic/.github/workflows/security-scanner-image.yml@refs/heads/main',
      workflowCommit: commit, sourceCommit: commit, signedAt: '2026-11-02T10:01:00Z',
      indexBundleDigest: digest('index-bundle'), provenanceBundleDigest: digest('dsse-slsa-bundle'),
      inclusionDigest: digest('inclusion'), checkpointDigest: digest('checkpoint'), offlinePackDigest: digest('offline-pack') },
    tokenInvalidated: true, resources: { bytes: artifact.size, storageBytes: artifact.size, headroomBytes: 100000 } };
  return { materials, receipts: { build, validation, publication }, artifactBytes, outputs,
    now: '2026-11-02T10:02:00Z' };
}
