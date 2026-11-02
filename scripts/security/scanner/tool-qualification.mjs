import { digest, validateFreshness, policy as defaultPolicy } from '../daily/toolchain-contract.mjs';
import { requireContract as check, text, integer, hash, timestamp, literal, list, record, equal, path } from './contract-schema.mjs';
import { PACKAGE } from './receipt-schema.mjs';

export const TOOL_ROLES = Object.freeze(['acquisition', 'root-bootstrap', 'sbom', 'uploader', 'verifier']);
export const SEVERITIES = Object.freeze(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const canonical = value => JSON.stringify(value);
const https = value => {
  if (!text(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; }
  catch { return false; }
};
const originOf = url => new URL(url).origin;
const count = value => Number.isSafeInteger(value) && value >= 0;
const arrayOf = rule => value => Array.isArray(value) && value.every(rule);

const baseTool = { role: text, name: text, url: https, digest: hash, size: integer };
const verifierSchema = record({ ...baseTool, role: literal('verifier'), repository: text, version: text,
  releaseTag: text, asset: text, releaseAssetDigest: hash, goVersion: text, buildInfoHash: hash,
  dependencyCount: integer, releaseImmutable: literal(true), selfScaEvidence: hash });
const rootBootstrapSchema = record({ ...baseTool, role: literal('root-bootstrap'), mirror: https,
  trustedRootDigest: hash, tufRoles: record({ root: hash, timestamp: hash, snapshot: hash, targets: hash }),
  observedAt: timestamp, refreshBy: timestamp });
const acquisitionSchema = record({ ...baseTool, role: literal('acquisition'), materialPath: path });
const sbomSchema = record({ ...baseTool, role: literal('sbom'), version: text, releaseTag: text, asset: text,
  releaseAssetDigest: hash, materialPath: path });
const uploaderPending = record({ role: literal('uploader'), name: literal('oras'), url: literal(null),
  digest: literal(null), size: literal(null), pendingReason: text,
  destinationAllowlist: value => equal(value, [PACKAGE]) });
const uploaderResolved = record({ role: literal('uploader'), name: literal('oras'), url: https, digest: hash,
  size: integer, version: text, releaseTag: text, asset: text, releaseAssetDigest: hash,
  destinationAllowlist: value => equal(value, [PACKAGE]) });
const inventorySchema = record({ schemaVersion: literal(1), status: literal('candidate-inventory'),
  trustOrigins: list(https),
  roles: arrayOf(value => value !== null && typeof value === 'object' && !Array.isArray(value) && text(value.role)),
  evidence: record({ verifierCandidate: hash, trustCustody: hash, selfScans: hash }) });

// Validates the declared tool inventory and its cross-binds only. Self-SCA freshness,
// content admission and actual execution remain separate r6 gates; this grants none.
export function validateToolInventory({ inventory, manifest, recipe, policy: p = defaultPolicy, evidenceFiles } = {}) {
  check(inventorySchema(inventory), 'tool inventory schema');
  check(equal([...inventory.roles.map(r => r.role)].sort(), [...TOOL_ROLES]), 'exact tool roles');
  const origins = recipe?.origins;
  check(arrayOf(https)(origins), 'recipe origins');
  check(Array.isArray(manifest?.materials), 'material manifest');
  check(evidenceFiles && typeof evidenceFiles === 'object', 'evidence files');
  const byRole = Object.fromEntries(inventory.roles.map(r => [r.role, r]));
  const v = byRole.verifier;
  check(verifierSchema(v), 'verifier tool schema');
  check(origins.includes(originOf(v.url)), 'verifier origin');
  const vc = p.signature?.verifierCandidate ?? {};
  check(v.repository === vc.repository && v.version === vc.version && v.digest === `sha256:${vc.sha256}` &&
    v.releaseImmutable === vc.releaseImmutable && v.releaseAssetDigest === v.digest, 'verifier candidate cross-bind');
  for (const [role, kind] of [['acquisition', 'acquisition-tool'], ['sbom', 'sbom-tool']]) {
    const t = byRole[role];
    check((role === 'acquisition' ? acquisitionSchema : sbomSchema)(t), `${role} tool schema`);
    check(origins.includes(originOf(t.url)), `${role} origin`);
    const matches = manifest.materials.filter(m => m?.kind === kind);
    check(matches.length === 1, `${kind} manifest entry`);
    const m = matches[0];
    check(t.materialPath === m.path && t.digest === m.digest && t.size === m.size && t.url === m.url,
      `${role} material cross-bind`);
    if (role === 'sbom') check(t.releaseAssetDigest === t.digest, 'sbom release asset digest');
  }
  const rb = byRole['root-bootstrap'];
  check(rootBootstrapSchema(rb), 'root-bootstrap schema');
  check(inventory.trustOrigins.includes(originOf(rb.url)) && inventory.trustOrigins.includes(rb.mirror), 'trust origins');
  check(rb.trustedRootDigest === rb.digest, 'trusted root digest');
  check(Date.parse(rb.refreshBy) > Date.parse(rb.observedAt), 'root bootstrap validity');
  let custody = null;
  try { custody = JSON.parse(evidenceFiles.trustCustody.toString('utf8')); } catch { custody = null; }
  check(custody !== null && typeof custody === 'object', 'trust custody document');
  check(custody.observedAt === rb.observedAt && custody.refreshBy === rb.refreshBy, 'trust custody window');
  check(custody.verification?.artifacts?.['trusted_root.json'] === rb.digest, 'trust custody trusted root');
  check(['root', 'timestamp', 'snapshot', 'targets'].every(r => custody.metadata?.[r]?.digest === rb.tufRoles[r]),
    'trust custody TUF roles');
  const up = byRole.uploader;
  const unresolved = [];
  if (up.digest === null) {
    check(uploaderPending(up), 'pending uploader schema');
    unresolved.push('uploader');
  } else {
    check(uploaderResolved(up), 'uploader tool schema');
    check(origins.includes(originOf(up.url)) && up.releaseAssetDigest === up.digest, 'uploader pins');
  }
  for (const [name, expected] of Object.entries(inventory.evidence)) {
    check(Buffer.isBuffer(evidenceFiles[name]) && digest(evidenceFiles[name]) === expected, `evidence bytes: ${name}`);
  }
  return { inventory, unresolved };
}

const reportSchema = record({ scanner: record({ name: text, digest: hash }),
  target: record({ digest: hash, size: integer }), scannedAt: timestamp,
  db: record({ Version: integer, UpdatedAt: text, DownloadedAt: text, NextUpdate: text }),
  severityCounts: record({ UNKNOWN: count, LOW: count, MEDIUM: count, HIGH: count, CRITICAL: count }),
  findings: arrayOf(record({ id: text, severity: value => SEVERITIES.includes(value) })) });

// Validates one tool's self-SCA report integrity, independence and freshness. A clean
// report for another binary, a self-scan or a vulnerable tool grants nothing by itself.
export function validateToolSelfSca(tool, report, { now, policy: p = defaultPolicy } = {}) {
  check(reportSchema(report), 'self-SCA report schema');
  check(report.target.digest === tool.digest && report.target.size === tool.size, 'wrong-binary report');
  check(report.scanner.digest !== tool.digest && report.scanner.name !== tool.name, 'self-scan is not independent');
  const scannedAt = Date.parse(report.scannedAt);
  check(Number.isFinite(now) && scannedAt <= now, 'scan time after observation');
  check(Date.parse(report.db.DownloadedAt) <= scannedAt, 'scan predates DB download');
  validateFreshness(report.db, report.db.Version, now, p);
  const counts = Object.fromEntries(SEVERITIES.map(s => [s, report.findings.filter(f => f.severity === s).length]));
  check(equal(counts, report.severityCounts), 'severity counts match findings');
  check(report.findings.length === Object.values(report.severityCounts).reduce((a, b) => a + b, 0), 'finding total');
  return { ...report, highCritical: report.severityCounts.HIGH + report.severityCounts.CRITICAL,
    reportDigest: digest(canonical(report)) };
}

const moduleSchema = record({ path: text, version: text });
export const moduleList = arrayOf(moduleSchema);

// The declared dependency inventory must cover every module embedded in the exact
// binary; an omitted, extra or changed embedded dependency refuses.
export function validateToolDependencies(tool, embedded, inventory) {
  check(moduleList(embedded) && moduleList(inventory), 'module lists');
  const key = m => `${m.path}@${m.version}`;
  check(embedded.length === inventory.length, 'dependency count');
  check(equal([...embedded.map(key)].sort(), [...inventory.map(key)].sort()), 'embedded dependency inventory');
  if (tool.dependencyCount !== undefined) check(tool.dependencyCount === embedded.length, 'declared dependency count');
  return { dependenciesDigest: digest(canonical({ embedded, inventory })) };
}

const zeroPythonSchema = record({ targetDigest: hash, pythonAbsent: literal(true), probeDigest: hash });

export function validateZeroPython(tool, evidence) {
  check(zeroPythonSchema(evidence), 'zero-Python evidence schema');
  check(evidence.targetDigest === tool.digest, 'zero-Python target binding');
  return { zeroPythonDigest: digest(canonical(evidence)) };
}

