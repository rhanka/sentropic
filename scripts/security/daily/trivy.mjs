// Preparation API for a trusted supervisor. No candidate report grants admission.
import { isAbsolute, join } from 'node:path';
import { assertQualified, digest, isDigest, policy, requireEvidence, validateScanner } from './toolchain-contract.mjs';
import { hashFile, restoreSnapshot } from './toolchain-cache.mjs';
import { failClosedReport } from './inventory.mjs';

// Only the trusted preparation path can establish archive identity; JSON cannot mint this proof.
const verifiedArchives = new WeakMap();

export function validateTarget(target, sourceSha, key) {
  requireEvidence(/^[a-f0-9]{40}$/.test(sourceSha || '') &&
    ['api-production', 'api-toolbox', 'ui-production'].includes(key), 'target source/surface');
  requireEvidence(target?.key === key && target.sourceSha === sourceSha && target.platform === policy.platform &&
    target.provenance?.verified === true && target.provenance.sourceSha === sourceSha &&
    target.provenance.imageRef === target.ref && target.provenance.platform === policy.platform &&
    isDigest(target.provenance.receiptHash) && isDigest(target.configDigest), 'target provenance/platform');
  requireEvidence(/^[a-z0-9.-]+(?::\d+)?\/[a-z0-9/_.-]+@sha256:[a-f0-9]{64}$/.test(target.ref || ''), 'immutable remote image');
  requireEvidence(Array.isArray(target.expectedResults) && target.expectedResults.length > 0 &&
    target.expectedResults.every((value) => typeof value === 'string' && value.length > 0) &&
    new Set(target.expectedResults).size === target.expectedResults.length, 'target coverage inventory');
  return target;
}
const safePath = (path) => {
  requireEvidence(typeof path === 'string' && isAbsolute(path) && !/[,\r\n\0]/.test(path), 'safe sandbox mount');
  return path;
};

export async function prepareImageScan({ target, sourceSha, key, snapshots, archive, now = Date.now() }) {
  validateTarget(target, sourceSha, key);
  // Java cannot be silently skipped; applicability/inventory qualification is still pending.
  requireEvidence(snapshots?.vulnerability && snapshots?.java, 'required vulnerability/Java DB snapshots');
  const receipts = {};
  const mounts = [];
  for (const kind of ['vulnerability', 'java']) {
    receipts[kind] = await restoreSnapshot(snapshots[kind], now);
    requireEvidence(receipts[kind].kind === kind, 'snapshot kind');
    const folder = kind === 'java' ? 'java-db' : 'db';
    const filename = kind === 'java' ? 'trivy-java.db' : 'trivy.db';
    for (const name of [filename, 'metadata.json']) mounts.push('--mount',
      `type=bind,src=${safePath(join(snapshots[kind].path, name))},dst=/cache/${folder}/${name},readonly`);
  }
  const args = ['image', '--config', '/dev/null', '--ignorefile', '/dev/null', '--cache-dir', '/cache',
    '--cache-backend', 'memory', '--scanners', 'vuln', '--format', 'json',
    '--severity', 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL', '--exit-code', '0', '--parallel', '1',
    '--skip-db-update', '--skip-java-db-update', '--offline-scan', '--skip-version-check', '--disable-telemetry',
    '--db-repository', policy.data.vulnerability.repository, '--java-db-repository', policy.data.java.repository,
    '--platform', policy.platform];
  if (archive) {
    requireEvidence(isDigest(archive.digest) && await hashFile(safePath(archive.path)) === archive.digest,
      'target archive integrity');
    mounts.push('--mount', `type=bind,src=${safePath(archive.path)},dst=/target/image.tar,readonly`);
    args.push('--input', '/target/image.tar');
    target = { ...target };
    verifiedArchives.set(target, { path: archive.path, digest: archive.digest });
  } else args.push('--image-src', 'remote', target.ref);
  return { command: 'docker', args: ['run', '--rm', '--pull=never', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--user', '65532:65532', '--pids-limit', '128', '--memory', '4g', '--cpus', '1',
    '--network', archive ? 'none' : 'bridge', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=256m',
    '--tmpfs', '/cache:rw,nosuid,nodev,noexec,size=16m', '--env', 'HOME=/tmp', ...mounts,
    '--platform', policy.platform, `${policy.repository}@${policy.manifestDigest}`, ...args],
    target, sourceSha, snapshots, parametersHash: digest(JSON.stringify(args.slice(0, -1))),
    policyHash: digest(JSON.stringify(policy)), databaseIdentity: Object.fromEntries(Object.entries(receipts).map(([kind, receipt]) =>
      [kind, { manifestDigest: receipt.manifestDigest, receiptHash: snapshots[kind].receiptHash }])),
    scannerIdentity: { version: policy.version, indexDigest: policy.indexDigest, manifestDigest: policy.manifestDigest } };
}

const reportLimit = 16 * 1024 * 1024;
function retainDiagnostics(error, stdout, result) {
  const bytes = Buffer.from(typeof stdout === 'string' ? stdout : '');
  const retained = bytes.subarray(0, reportLimit).toString();
  error.scanEvidence = { status: result.status, signal: result.signal || null,
    processError: typeof result.error?.message === 'string' ? result.error.message.slice(0, 4096) : null,
    stdout: retained, rawHash: digest(retained), reportBytes: bytes.length, truncated: bytes.length > reportLimit,
    stderr: Buffer.from(typeof result.stderr === 'string' ? result.stderr : '').subarray(0, reportLimit).toString() };
  return error;
}
export function validateImageReport(stdout, target, execution = { status: 0 }) {
  try {
    requireEvidence(execution.status === 0 && !execution.error && !execution.signal, 'Trivy command failed');
    requireEvidence(typeof stdout === 'string' && Buffer.byteLength(stdout) <= reportLimit, 'report byte/type bound');
    const parsed = failClosedReport(stdout);
    const archive = verifiedArchives.get(target);
    const identityMatches = archive ? parsed.ArtifactName === '/target/image.tar' && parsed.ArtifactType === 'container_image'
      : parsed.Metadata?.RepoDigests?.includes(target.ref);
    requireEvidence(parsed.SchemaVersion === 2 && parsed.Metadata?.ImageID === target.configDigest &&
      identityMatches, 'report target identity');
    const actual = parsed.Results.map((result) => `${result.Target}|${result.Class}|${result.Type}`).sort();
    requireEvidence(JSON.stringify(actual) === JSON.stringify([...target.expectedResults].sort()), 'partial image coverage');
    for (const result of parsed.Results) for (const finding of result.Vulnerabilities || []) {
      requireEvidence(typeof finding.VulnerabilityID === 'string' && typeof finding.PkgName === 'string' &&
        typeof finding.InstalledVersion === 'string' &&
        ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(finding.Severity), 'malformed vulnerability');
    }
    return parsed;
  } catch (error) {
    throw retainDiagnostics(error, stdout, execution);
  }
}

export async function executeImageScan(options, scannerEvidence, execute) {
  assertQualified(); // Frozen false in S2b preparation. No CLI/env override exists.
  validateScanner(scannerEvidence);
  const plan = await prepareImageScan(options);
  requireEvidence(typeof execute === 'function', 'trusted credential-free supervisor required');
  const result = await execute(plan.command, plan.args, { env: { PATH: '/usr/bin:/bin' },
    shell: false, timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  try {
    validateImageReport(result.stdout, plan.target, result);
    const archive = verifiedArchives.get(plan.target);
    if (archive) requireEvidence(await hashFile(archive.path) === archive.digest, 'target archive changed during scanning');
    // A DB that expired during scanning cannot support absence/reconciliation/merge.
    for (const snapshot of Object.values(plan.snapshots)) await restoreSnapshot(snapshot);
  } catch (error) {
    if (!error.scanEvidence) retainDiagnostics(error, result.stdout, result);
    Object.assign(error.scanEvidence, { scannerIdentity: plan.scannerIdentity, databaseIdentity: plan.databaseIdentity });
    throw error;
  }
  return { ...result, rawHash: digest(result.stdout), scannerIdentity: plan.scannerIdentity,
    databaseIdentity: plan.databaseIdentity, target: plan.target, sourceSha: plan.sourceSha,
    parametersHash: plan.parametersHash, policyHash: plan.policyHash, snapshots: plan.snapshots };
}

export async function validateComparison(before, after, now = Date.now()) {
  requireEvidence(before.status === 0 && after.status === 0 && isDigest(before.rawHash) && isDigest(after.rawHash) &&
    before.target?.key === after.target?.key && before.target?.platform === policy.platform &&
    after.target?.platform === policy.platform, 'comparison scan receipts');
  for (const field of ['parametersHash', 'policyHash', 'scannerIdentity', 'databaseIdentity']) {
    requireEvidence(before[field] && JSON.stringify(before[field]) === JSON.stringify(after[field]),
      `comparison changed ${field}; rescan both inputs`);
  }
  for (const scan of [before, after]) {
    for (const kind of ['vulnerability', 'java']) {
      const snapshot = scan.snapshots?.[kind];
      requireEvidence(snapshot && snapshot.receiptHash === scan.databaseIdentity[kind]?.receiptHash &&
        snapshot.manifestDigest === scan.databaseIdentity[kind]?.manifestDigest, 'comparison snapshot identity');
      await restoreSnapshot(snapshot, now);
    }
  }
  return true;
}

export function requireIacQualification() {
  throw new Error('coverage-blocked: IaC rules snapshot and complete multi-document adaptation require qualification');
}
