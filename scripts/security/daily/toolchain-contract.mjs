import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const isDigest = (value) => /^sha256:[a-f0-9]{64}$/.test(value || '');
export function requireEvidence(condition, message) {
  if (!condition) throw new Error(`coverage-blocked: ${message}`);
}
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
// Policy belongs to the trusted runner checkout, never the repository under scan.
export const policy = freeze(JSON.parse(readFileSync(new URL('../../../.security/trivy-toolchain.json', import.meta.url))));

const PROFILES = freeze({
  upstream: {
    repository: 'aquasec/trivy',
    issuer: 'https://token.actions.githubusercontent.com',
    identity: 'https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.1',
  },
  'sentropic-patched': {
    repository: 'ghcr.io/rhanka/sentropic-trivy',
    issuer: 'https://token.actions.githubusercontent.com',
    identity: 'https://github.com/rhanka/sentropic/.github/workflows/security-scanner-image.yml@refs/heads/main',
  },
});

export function validateScanner({ indexBytes, manifestBytes, configBytes, signature }, p = policy) {
  const version = p.version.split('.').map(Number);
  requireEvidence(/^\d+\.\d+\.\d+$/.test(p.version) && (version[0] > 0 || version[1] > 71 ||
    (version[1] === 71 && version[2] >= 1)), 'Trivy must be >= 0.71.1');
  requireEvidence(p.profile === 'upstream' || p.profile === 'sentropic-patched', 'unknown publisher profile');
  const fixed = PROFILES[p.profile];
  requireEvidence(p.repository === fixed.repository && p.signature.issuer === fixed.issuer &&
    p.signature.identity === fixed.identity, 'publisher profile pins');
  const table = p.publishers?.[p.profile];
  requireEvidence(table?.repository === fixed.repository && table?.signature?.issuer === fixed.issuer &&
    table?.signature?.identity === fixed.identity, 'publisher profile table pins');
  if (p.profile === 'sentropic-patched') {
    requireEvidence(isDigest(table?.indexDigest) && isDigest(table?.manifestDigest) &&
      isDigest(table?.configDigest) && table?.qualified === true, 'sentropic-patched candidate unadmitted');
  }
  requireEvidence(p.platform === 'linux/amd64' &&
    [p.indexDigest, p.manifestDigest, p.configDigest].every(isDigest), 'frozen scanner pins/platform');
  requireEvidence(digest(indexBytes) === p.indexDigest && digest(manifestBytes) === p.manifestDigest &&
    digest(configBytes) === p.configDigest, 'scanner bytes differ from reviewed pins');
  const index = JSON.parse(indexBytes);
  const matches = index.manifests?.filter((item) => item.platform?.os === 'linux' && item.platform?.architecture === 'amd64');
  requireEvidence(matches?.length === 1 && matches[0].digest === p.manifestDigest &&
    matches[0].size === Buffer.byteLength(manifestBytes), 'index/platform link');
  const manifest = JSON.parse(manifestBytes);
  const config = JSON.parse(configBytes);
  requireEvidence(manifest.config?.digest === p.configDigest && manifest.config.size === Buffer.byteLength(configBytes) &&
    config.os === 'linux' && config.architecture === 'amd64' &&
    config.config?.Labels?.['org.opencontainers.image.version'] === p.version &&
    config.config?.Labels?.['org.opencontainers.image.revision'] === p.revision, 'scanner config provenance');
  // Signature result is supplied only by a trusted admitted verifier, never an untrusted report.
  requireEvidence(signature?.verified === true && signature.digest === p.indexDigest &&
    signature.issuer === p.signature.issuer && signature.identity === p.signature.identity &&
    isDigest(signature.bundleHash), 'exact publisher/index signature');
  requireEvidence(!p.signature.requirePlatformSignature || signature.platformDigest === p.manifestDigest,
    'required platform signature');
  return { indexDigest: p.indexDigest, manifestDigest: p.manifestDigest, platform: p.platform, version: p.version };
}

export function validateFreshness(metadata, schema, now = Date.now(), p = policy) {
  const timestamps = ['UpdatedAt', 'NextUpdate', 'DownloadedAt'].map((key) => {
    const value = metadata?.[key];
    return typeof value === 'string' && /(?:Z|\+00:00)$/.test(value) ? Date.parse(value) : NaN;
  });
  const [updated, next, downloaded] = timestamps;
  requireEvidence(metadata?.Version === schema && timestamps.every(Number.isFinite) && Number.isFinite(now) &&
    updated <= downloaded && downloaded <= now && updated <= now && now <= next &&
    now - updated <= p.data.maxAgeSeconds * 1000, 'DB schema/freshness');
  return metadata;
}

export function assertQualified(p = policy) {
  requireEvidence(p.qualified && p.signature.verifierAdmitted && p.signature.contentAdmitted &&
    p.data.checks.qualified && p.blockers.length === 0, 'S2b qualification pending');
}
