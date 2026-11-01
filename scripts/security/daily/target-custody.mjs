// ACT-L05 (r6 wave W2): exact main image cohort resolution (L5-A) and the
// trusted acquisition boundary (L5-B). Receipts are validated in the daily
// adapter seams; nothing here performs a live registry call or holds a credential.
import { isAbsolute } from 'node:path';
import { digest, isDigest, policy, requireEvidence } from './toolchain-contract.mjs';

export const COHORT_KEYS = ['api-production', 'api-toolbox', 'ui-production'];

// Producer CI job per cohort surface (protected ci.yml), fixed at admission.
export const PRODUCER_JOBS = Object.freeze({
  'api-production': 'build-api-image',
  'api-toolbox': 'build-api-tool-image',
  'ui-production': 'build-ui',
});

// Repository image name per cohort surface (Makefile image name defaults).
export const COHORT_IMAGES = Object.freeze({
  'api-production': 'sentropic-api',
  'api-toolbox': 'sentropic-api-tools',
  'ui-production': 'sentropic-ui',
});

const TAG_REF = /^[a-z0-9.-]+(?::\d+)?\/[a-z0-9/_.-]+:[a-z0-9][a-z0-9._-]*$/i;
const CREDENTIAL_ENV = /TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL|AUTH|DOCKER_CONFIG/i;

// Resolve the three-image cohort once at one immutable main SHA. Every surface
// must match its producer job, registry/config/platform/layer identities and
// the admitted immutable ref; any mismatch rejects the whole cohort before scan.
export function resolveCohort({ sourceSha, workflowBytes, registry, producers, jobs, inspections, admittedRefs = {} }) {
  requireEvidence(/^[a-f0-9]{40}$/.test(sourceSha || ''), 'immutable main source SHA');
  requireEvidence(Buffer.isBuffer(workflowBytes) && workflowBytes.length > 0, 'protected workflow bytes');
  requireEvidence(typeof registry === 'string' && /^[a-z0-9.-]+(?::\d+)?\/[a-z0-9/_.-]+$/i.test(registry), 'registry prefix');
  requireEvidence(producers && jobs && inspections && typeof producers === 'object' &&
    Array.isArray(jobs) && typeof inspections === 'object', 'cohort inputs');
  const workflowDigest = digest(workflowBytes);
  const targets = {};
  for (const key of COHORT_KEYS) {
    const producer = producers[key];
    requireEvidence(producer && typeof producer === 'object', `missing producer: ${key}`);
    const job = jobs.find((entry) => entry?.name === PRODUCER_JOBS[key]);
    requireEvidence(job, `missing producer job: ${PRODUCER_JOBS[key]}`);
    requireEvidence(job.conclusion === 'success', `producer job not successful: ${PRODUCER_JOBS[key]}`);
    requireEvidence(job.head_sha === sourceSha, `producer job head SHA differs: ${key}`);
    requireEvidence(producer.sourceSha === sourceSha, `producer source SHA differs: ${key}`);
    requireEvidence(producer.runId === String(job.run_id) && producer.producer?.attempt === String(job.run_attempt),
      `producer run/attempt mismatch: ${key}`);
    requireEvidence(producer.producer?.job === PRODUCER_JOBS[key], `producer job name mismatch: ${key}`);
    requireEvidence(producer.workflowDigest === workflowDigest, `producer workflow digest mismatch: ${key}`);
    requireEvidence(producer.architecture === policy.platform, `producer platform mismatch: ${key}`);
    requireEvidence(TAG_REF.test(producer.ref || ''), `producer tag ref malformed: ${key}`);
    const [repo, tag] = producer.ref.split(':');
    requireEvidence(repo === `${registry}/${COHORT_IMAGES[key]}`, `unrelated image for ${key}`);
    requireEvidence(!/^(latest|main|master)$/i.test(tag), `mutable tag for ${key}`);
    const inspection = inspections[key];
    requireEvidence(inspection && typeof inspection === 'object', `missing registry inspection: ${key}`);
    const descriptor = inspection.Descriptor;
    requireEvidence(descriptor?.platform?.os === 'linux' && descriptor?.platform?.architecture === 'amd64' &&
      isDigest(descriptor.digest), `unique linux/amd64 platform descriptor: ${key}`);
    requireEvidence(inspection.SchemaV2Manifest?.config?.digest === producer.imageId &&
      isDigest(producer.imageId), `registry/config identity mismatch: ${key}`);
    requireEvidence(Array.isArray(inspection.Layers) && inspection.Layers.length > 0 &&
      inspection.Layers.every((layer) => isDigest(layer?.digest)), `layer chain: ${key}`);
    const admitted = admittedRefs[key];
    requireEvidence(admitted === undefined || admitted === descriptor.digest, `tag movement for ${key}`);
    const ref = `${repo}@${descriptor.digest}`;
    targets[key] = { key, ref, sourceSha, platform: policy.platform, configDigest: producer.imageId,
      expectedResults: [`${COHORT_IMAGES[key]}|os-pkgs|alpine`],
      provenance: { verified: true, sourceSha, imageRef: ref, platform: policy.platform,
        receiptHash: digest(JSON.stringify(producer)) } };
  }
  return { sourceSha, registry, workflowDigest, targets };
}

// L5-B: the target-scoped pull credential lives only in the trusted acquisition
// step's private directory. Scanner children, bridge paths and candidate tools
// must never see it: not in argv, env, mounts or env-files.
export function validateAcquisitionBoundary({ credentialDir, scannerArgs, scannerEnv, mounts }) {
  requireEvidence(typeof credentialDir === 'string' && isAbsolute(credentialDir), 'trusted credential directory');
  requireEvidence(Array.isArray(scannerArgs) && scannerArgs.every((arg) => typeof arg === 'string'), 'scanner argv');
  requireEvidence(scannerEnv && typeof scannerEnv === 'object' && !Array.isArray(scannerEnv), 'scanner env');
  requireEvidence(Array.isArray(mounts), 'scanner mounts');
  const serialized = JSON.stringify(scannerArgs);
  requireEvidence(!serialized.includes(credentialDir), 'credential directory in scanner argv');
  requireEvidence(!scannerArgs.includes('--env-file'), 'env-file flag in scanner argv');
  for (const [name, value] of Object.entries(scannerEnv)) {
    requireEvidence(!CREDENTIAL_ENV.test(name), `credential env key: ${name}`);
    requireEvidence(typeof value === 'string' && !value.includes(credentialDir), `credential env value: ${name}`);
  }
  for (const mount of mounts) {
    requireEvidence(mount && typeof mount.src === 'string' && isAbsolute(mount.src), 'absolute mount source');
    requireEvidence(!mount.src.includes(credentialDir) && !mount.src.startsWith(`${credentialDir}/`), 'credential directory mounted');
    requireEvidence(mount.readonly === true, 'scanner mounts must be read-only');
  }
  return true;
}

// L5-B: anonymous public CI image acquisition keeps the digest/visibility gates.
// A private package, an auth requirement, a credential or a private re-upload
// fallback all refuse; no package-read PAT is a fallback.
export function validateAnonymousImagePull({ packageName, visibility, ref, credentialUsed = false,
  authRequired = false, reuploadFallback = false }) {
  requireEvidence(packageName === 'ghcr.io/rhanka/sentropic-trivy', 'allowlisted public package only');
  requireEvidence(visibility === 'public', 'package visibility must be public');
  requireEvidence(typeof ref === 'string' && ref.startsWith(`${packageName}@sha256:`) && isDigest(ref.slice(packageName.length + 1)),
    'digest-pinned anonymous ref');
  requireEvidence(credentialUsed === false && authRequired === false, 'anonymous acquisition requires no credential');
  requireEvidence(reuploadFallback === false, 'no private image re-upload fallback');
  return true;
}
