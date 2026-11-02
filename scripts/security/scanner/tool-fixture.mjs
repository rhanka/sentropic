// Synthetic data for contract tests only; this is never an admission receipt.
import { digest } from '../daily/toolchain-contract.mjs';

export const fixtureNow = Date.parse('2026-11-02T12:00:00Z');

export function toolFixture() {
  const origins = ['https://github.com', 'https://curl.se'];
  const tool = (role, name, bytes, extra = {}) => {
    const url = `${origins[0]}/${role}/${name}`;
    return { role, name, url, digest: digest(Buffer.from(bytes)), size: Buffer.byteLength(bytes), ...extra };
  };
  const verifier = tool('verifier', 'cosign', 'synthetic cosign binary', {
    repository: 'sigstore/cosign', version: '3.1.4', releaseTag: 'v3.1.4', asset: 'cosign-linux-amd64',
    releaseAssetDigest: digest(Buffer.from('synthetic cosign binary')), goVersion: 'go1.27.3',
    buildInfoHash: digest('buildinfo'), dependencyCount: 2, releaseImmutable: true,
    selfScaEvidence: digest('dated self sca'),
  });
  const rootBootstrap = tool('root-bootstrap', 'sigstore-tuf-trusted-root', '{"trustedRoot":true}', {
    mirror: 'https://tuf.example.dev', trustedRootDigest: digest(Buffer.from('{"trustedRoot":true}')),
    tufRoles: { root: digest('root'), timestamp: digest('timestamp'), snapshot: digest('snapshot'), targets: digest('targets') },
    observedAt: '2026-11-01T00:00:00Z', refreshBy: '2026-11-08T00:00:00Z',
  });
  rootBootstrap.url = 'https://tuf.example.dev/trusted_root.json';
  const acquisition = tool('acquisition', 'cacert-pem', 'synthetic ca bundle', { materialPath: 'tools/acquisition/cacert.pem' });
  acquisition.url = `${origins[1]}/ca/cacert.pem`;
  const sbom = tool('sbom', 'syft', 'synthetic syft archive', {
    version: '1.55.0', releaseTag: 'v1.55.0', asset: 'syft_linux_amd64.tar.gz',
    releaseAssetDigest: digest(Buffer.from('synthetic syft archive')), materialPath: 'tools/sbom/syft.tar.gz',
  });
  const uploader = tool('uploader', 'oras', 'synthetic oras binary', {
    version: '1.3.0', releaseTag: 'v1.3.0', asset: 'oras_linux_amd64.tar.gz',
    releaseAssetDigest: digest(Buffer.from('synthetic oras binary')),
    destinationAllowlist: ['ghcr.io/rhanka/sentropic-trivy'],
  });
  const custodyBytes = Buffer.from(JSON.stringify({ schema: 1, observedAt: rootBootstrap.observedAt,
    refreshBy: rootBootstrap.refreshBy, verification: { artifacts: { 'trusted_root.json': rootBootstrap.digest } },
    metadata: Object.fromEntries(Object.entries(rootBootstrap.tufRoles).map(([k, v]) => [k, { digest: v }])) }));
  const inventory = {
    schemaVersion: 1, status: 'candidate-inventory', trustOrigins: ['https://tuf.example.dev'],
    roles: [verifier, rootBootstrap, acquisition, sbom, uploader],
    evidence: { verifierCandidate: digest('verifier bundle'), trustCustody: digest(custodyBytes), selfScans: digest('scan bundle') },
  };
  const policy = {
    signature: { verifierCandidate: { repository: 'sigstore/cosign', version: '3.1.4',
      sha256: verifier.digest.slice(7), releaseImmutable: true } },
    data: { maxAgeSeconds: 86400 },
  };
  const recipe = { origins };
  const manifest = { schemaVersion: 1, recipeDigest: digest('recipe'), materials: [
    { path: acquisition.materialPath, kind: 'acquisition-tool', url: acquisition.url, digest: acquisition.digest, size: acquisition.size },
    { path: sbom.materialPath, kind: 'sbom-tool', url: sbom.url, digest: sbom.digest, size: sbom.size },
  ] };
  const report = (t, overrides = {}) => ({
    scanner: { name: 'independent-scanner', digest: digest('scanner binary') },
    target: { digest: t.digest, size: t.size },
    scannedAt: '2026-11-02T12:00:00Z',
    db: { Version: 2, UpdatedAt: '2026-11-02T06:00:00Z', DownloadedAt: '2026-11-02T11:00:00Z', NextUpdate: '2026-11-03T06:00:00Z' },
    severityCounts: { UNKNOWN: 1, LOW: 1, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
    findings: [{ id: 'CVE-0000-0001', severity: 'UNKNOWN' }, { id: 'CVE-0000-0002', severity: 'LOW' }],
    ...overrides,
  });
  const reports = Object.fromEntries(inventory.roles.map(r => [r.role, report(r)]));
  const modules = [{ path: 'github.com/example/a', version: 'v1.0.0' }, { path: 'github.com/example/b', version: 'v2.0.0' }];
  const dependencies = Object.fromEntries(inventory.roles.map(r => [r.role, {
    embedded: r.role === 'verifier' ? structuredClone(modules) : [],
    inventory: r.role === 'verifier' ? structuredClone(modules) : [] }]));
  const zeroPython = Object.fromEntries(inventory.roles.map(r => [r.role, { targetDigest: r.digest, pythonAbsent: true, probeDigest: digest(`probe ${r.role}`) }]));
  const review = { identity: 'reviewer@example', model: 'independent-model', disposition: 'approved', digest: digest('review') };
  const evidenceFiles = { verifierCandidate: Buffer.from('verifier bundle'), trustCustody: custodyBytes,
    selfScans: Buffer.from('scan bundle') };
  return { inventory, policy, recipe, manifest, reports, dependencies, zeroPython, review, evidenceFiles, now: fixtureNow };
}
