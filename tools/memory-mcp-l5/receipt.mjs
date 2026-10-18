#!/usr/bin/env node
// receipt.mjs — L5-MEMORY-V1 receipt & contract verifier. Lot 0 specifies it; Lot 1 wires it.
// preflight: report outstanding obligations, never emit an accepted checkpoint.
// checkpoint: strict post-run gate, exits nonzero on any failure, never downgrades one.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const PROOF_IDS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10'];
export const ACCEPTANCE_ROLES = ['l4', 'platform', 'broker', 'transport'];
export const ARTIFACT_ROLES = ['l4', 'platform', 'broker', 'mesh', 'dependency'];
export const FROZEN_SPEC_SHA256 = 'f90c927964b44fdf6ad712eee9b894762250239384643a3790931c142d3aeeca';
export const CHECKPOINT_KEYS = [
  'schemaVersion', 'checkpoint', 'phase', 'tupleSha256', 'source', 'contracts', 'preCandidate',
  'artifacts', 'closure', 'runtime', 'assurance', 'proofs', 'importGraph', 'ci', 'ownerUat', 'acceptances',
];
export const FORBIDDEN_IMPORT_PARTS = [
  'cluster-mesh/src', '/mock/', 'mock/oidc', '/testing', 'experimental/', 'createInMemoryContext',
  '/durable', '/elicitation', '/persistence', '/stores', '/audit', 'MemoryRecordStore', 'FileRecordStore', 'InMemoryAuditSink',
];

export const isSha256Hex = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export const isCommitSha = (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
export const isSha512Integrity = (v) => typeof v === 'string' && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(v);
export const hasPathTraversal = (v) => typeof v !== 'string' || v.length === 0 || v.includes('\0') || v.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(v);
export const hasExternalSourceAlias = (v) => typeof v === 'string' && /^(file:|link:|portal:|workspace:|git\+|github:|https?:)/.test(v.trim());
export const sha256OfBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function findDuplicateKeys(records, keyFn) {
  const seen = new Set(), dups = new Set();
  for (const r of records || []) { const k = keyFn(r); if (seen.has(k)) dups.add(k); seen.add(k); }
  return [...dups];
}

export function isForbiddenImport(specifier) {
  if (typeof specifier !== 'string' || specifier.length === 0 || hasExternalSourceAlias(specifier)) return true;
  return FORBIDDEN_IMPORT_PARTS.some((part) => specifier.includes(part));
}

export function checkNodeFloor(version, execArgv = []) {
  if (Array.isArray(execArgv) && execArgv.some((arg) => typeof arg === 'string' && arg.includes('sqlite'))) return false;
  const m = typeof version === 'string' ? version.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/) : null;
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj === 22 ? min >= 13 : maj === 23 ? min >= 4 : maj > 23;
}

export function checkMakeCommand(command) {
  const failures = [];
  if (typeof command !== 'string' || !command.startsWith('make ')) failures.push('make: must start with "make "');
  if (typeof command === 'string' && /(^|\s)-f(\s|$)/.test(command)) failures.push('make: -f bypass is forbidden');
  for (const port of ['API_PORT=9625', 'UI_PORT=5825', 'MAILDEV_UI_PORT=1725']) {
    if (typeof command !== 'string' || !command.includes(port)) failures.push(`make: missing ${port}`);
  }
  const tokens = typeof command === 'string' ? command.trim().split(/\s+/) : [];
  if (!/^ENV=(test|e2e)-feat-memory-mcp-l5$/.test(tokens[tokens.length - 1] || '')) failures.push('make: ENV=<test|e2e>-feat-memory-mcp-l5 must be last');
  return failures;
}

export function checkFixtureProvenance(doc) {
  if (!doc || typeof doc !== 'object') return ['fixtures: not an object'];
  const failures = [];
  if (doc.specSha256 !== FROZEN_SPEC_SHA256) failures.push('fixtures.specSha256: must match frozen v3.1 digest');
  if (!isCommitSha(doc.l0Commit)) failures.push('fixtures.l0Commit: must be a 40-hex commit');
  if (!isSha256Hex(doc.coOwnerReceiptSha256)) failures.push('fixtures.coOwnerReceiptSha256: must be full lowercase SHA-256');
  if (!Array.isArray(doc.files) || doc.files.length === 0) failures.push('fixtures.files: must be nonempty');
  for (const dup of findDuplicateKeys(doc.files, (f) => f && f.path)) failures.push(`fixtures.files: duplicate path ${dup}`);
  for (const f of doc.files || []) if (!f || hasPathTraversal(f.path) || hasPathTraversal(f.upstreamPath) || !isSha256Hex(f.sha256)) failures.push(`fixtures.files/${f && f.path}: invalid entry`);
  return failures;
}

export function checkArtifactManifest(doc, options = {}) {
  if (!doc || typeof doc !== 'object') return ['manifest: not an object'];
  const failures = [];
  for (const k of Object.keys(doc)) if (!['manifestVersion', 'artifacts', 'contractInventory'].includes(k)) failures.push(`manifest: extra key ${k}`);
  if (doc.manifestVersion !== 1) failures.push('manifest.manifestVersion: must be 1');
  if (!Array.isArray(doc.artifacts) || doc.artifacts.length === 0) failures.push('manifest.artifacts: must be nonempty');
  if (!Array.isArray(doc.contractInventory) || doc.contractInventory.length === 0) failures.push('manifest.contractInventory: must be nonempty');
  for (const dup of findDuplicateKeys(doc.artifacts, (a) => a && a.name)) failures.push(`manifest.artifacts: duplicate name ${dup}`);
  for (const dup of findDuplicateKeys(doc.artifacts, (a) => a && a.archive)) failures.push(`manifest.artifacts: duplicate archive ${dup}`);
  for (const a of doc.artifacts || []) if (!a || !a.name || !a.version || hasExternalSourceAlias(a.version) || hasPathTraversal(a.archive) || !isSha256Hex(a.sha256) || !isSha512Integrity(a.integrity)) failures.push(`manifest.artifacts/${a && a.name}: invalid artifact record`);
  for (const dup of findDuplicateKeys(doc.contractInventory, (c) => c && c.path)) failures.push(`manifest.contractInventory: duplicate path ${dup}`);
  for (const c of doc.contractInventory || []) if (!c || hasPathTraversal(c.path) || !isSha256Hex(c.sha256)) failures.push(`manifest.contractInventory/${c && c.path}: invalid contract record`);
  if (options.retainedContractInventory && JSON.stringify(doc.contractInventory || []) !== JSON.stringify(options.retainedContractInventory)) failures.push('manifest.contractInventory: differs from retained pre-candidate');
  return failures;
}

export function checkProofRecords(proofs, expectedManifestSha256, expectedSourceHead) {
  if (!Array.isArray(proofs) || proofs.length !== PROOF_IDS.length) return [`proofs: expected exactly ${PROOF_IDS.length} records`];
  const failures = [], ids = proofs.map((p) => p && p.id);
  for (const id of ids) if (!PROOF_IDS.includes(id)) failures.push(`proofs: unknown id ${JSON.stringify(id)}`);
  for (const id of PROOF_IDS) if (!ids.includes(id)) failures.push(`proofs: missing id ${id}`);
  for (const dup of findDuplicateKeys(proofs, (p) => p && p.id)) failures.push(`proofs: duplicate id ${dup}`);
  for (const p of proofs) {
    const label = (p && p.id) || '?', r = p && p.result;
    if (!p || !Array.isArray(p.files) || p.files.length === 0 || typeof p.command !== 'string' || p.command.length === 0) failures.push(`proofs/${label}: files and command must be nonempty`);
    if (!r || r.format !== 'vitest-json' || !(Number.isInteger(r.passed) && r.passed > 0) || r.failed !== 0 || r.skipped !== 0 || r.todo !== 0) failures.push(`proofs/${label}: invalid vitest-json counts`);
    if (!r || !isSha256Hex(r.sha256) || !isSha256Hex(r.executedCasesSha256) || !isSha256Hex(p.artifactManifestSha256) || !isCommitSha(p.sourceHead)) failures.push(`proofs/${label}: bad digest or binding`);
    if (isSha256Hex(expectedManifestSha256) && p && p.artifactManifestSha256 !== expectedManifestSha256) failures.push(`proofs/${label}: cross-digest proof reuse`);
    if (isCommitSha(expectedSourceHead) && p && p.sourceHead !== expectedSourceHead) failures.push(`proofs/${label}: stale sourceHead`);
  }
  return failures;
}

export function checkCheckpoint(doc, options = {}) {
  if (!doc || typeof doc !== 'object') return ['checkpoint: not an object'];
  const failures = [], src = doc.source || {}, contracts = doc.contracts || {}, pre = doc.preCandidate || {}, closure = doc.closure || {}, rt = doc.runtime || {};
  for (const k of Object.keys(doc)) if (!CHECKPOINT_KEYS.includes(k)) failures.push(`checkpoint: extra key ${k}`);
  if (doc.schemaVersion !== 1 || doc.checkpoint !== 'L5-MEMORY-V1') failures.push('checkpoint: must be L5-MEMORY-V1 schemaVersion 1');
  if (doc.phase !== 'candidate' && doc.phase !== 'published') failures.push('phase: must be candidate or published');
  if (!isSha256Hex(doc.tupleSha256)) failures.push('tupleSha256: must be full lowercase SHA-256');
  for (const k of ['head', 'base', 'merge', 'checkout']) if (!isCommitSha(src[k])) failures.push(`source.${k}: must be a 40-hex commit`);
  if (!isSha256Hex(src.sourceTreeSha256) || !isCommitSha(contracts.l0Commit)) failures.push('source/contracts: invalid tree or l0Commit');
  for (const k of ['specSha256', 'registrySha256', 'gatewaySha256']) if (!isSha256Hex(contracts[k])) failures.push(`contracts.${k}: bad digest`);
  if (!isSha256Hex(pre.manifestSha256) || !options.manifestBytes || sha256OfBytes(options.manifestBytes) !== pre.manifestSha256) failures.push('preCandidate.manifestSha256: mismatch or absent manifestBytes');
  if (options.l4BuildReceipt && options.l4BuildReceipt.builtAgainstPreCandidateSha256 !== pre.manifestSha256) failures.push('preCandidate.l4BuildReceipt: builtAgainstPreCandidateSha256 mismatch');
  if (options.contractComparison && options.contractComparison.identical !== true) failures.push('preCandidate.contractComparison: contract bytes or inventory changed');
  if (!Array.isArray(doc.artifacts) || doc.artifacts.length === 0) failures.push('artifacts: must be nonempty');
  for (const dup of findDuplicateKeys(doc.artifacts, (a) => `${a && a.role}:${a && a.name}`)) failures.push(`artifacts: duplicate role/name ${dup}`);
  for (const k of ['artifactManifestSha256', 'declaredLockSha256', 'installedLockSha256', 'installedClosureSha256', 'referenceSourceSha256']) if (!isSha256Hex(closure[k])) failures.push(`closure.${k}: bad digest`);
  if (closure.sdkRange !== '^1.31.0') failures.push('closure.sdkRange: must be ^1.31.0');
  if (!checkNodeFloor(rt.nodeVersion, options.execArgv)) failures.push('runtime.nodeVersion: below floor or flag-dependent SQLite');
  if (rt.driver !== 'node:sqlite' || rt.journalMode !== 'WAL' || rt.synchronous !== 'FULL' || rt.pythonCount !== 0 || rt.addonBuildCount !== 0) failures.push('runtime: invalid sqlite/build invariants');
  const assurance = doc.assurance || {}, graph = doc.importGraph || {}, ci = doc.ci || {}, uat = doc.ownerUat || {};
  for (const k of ['productionPolicySha256', 'qualificationPolicySha256', 'verifierArtifactSha256', 'trustProfileSha256']) if (!isSha256Hex(assurance[k])) failures.push(`assurance.${k}: bad digest`);
  if (assurance.qualificationOnly !== true) failures.push('assurance.qualificationOnly: must be true');
  failures.push(...checkProofRecords(doc.proofs, closure.artifactManifestSha256, src.head));
  if (graph.forbiddenHits !== 0 || graph.unresolvedEdges !== 0) failures.push('importGraph: forbiddenHits and unresolvedEdges must both be zero');
  if (ci.workflow !== '.github/workflows/ci.yml' || !Array.isArray(ci.jobs) || ci.jobs.length === 0) failures.push('ci: invalid workflow or empty jobs');
  for (const j of ci.jobs || []) if (j.conclusion !== 'success' || !isSha256Hex(j.resultSha256)) failures.push(`ci job ${j && j.id}: must succeed with a result digest`);
  if (uat.status === 'passed' ? !isSha256Hex(uat.policySha256) : uat.status === 'owner-deferred' ? !['L6', 'L8'].includes(uat.owningLot) : true) failures.push('ownerUat: invalid decision record');
  const roles = (doc.acceptances || []).map((a) => a && a.role);
  for (const role of ACCEPTANCE_ROLES) if (!roles.includes(role)) failures.push(`acceptances: missing ${role} disposition`);
  for (const a of doc.acceptances || []) if (a.verdict !== 'accepted' || !isSha256Hex(a.tupleSha256)) failures.push(`acceptances/${a && a.role}: invalid acceptance`);
  return failures;
}

if (process.argv[1] && process.argv[1].endsWith('/receipt.mjs')) {
  const argv = process.argv.slice(2), arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const mode = arg('--mode'), checkpointPath = arg('--checkpoint'), manifestPath = arg('--manifest');
  if ((mode !== 'preflight' && mode !== 'checkpoint') || !checkpointPath) { console.error('usage: receipt.mjs --mode preflight|checkpoint --checkpoint <path> [--manifest <path>]'); process.exit(2); }
  const doc = JSON.parse(readFileSync(checkpointPath, 'utf8'));
  const failures = checkCheckpoint(doc, { manifestBytes: manifestPath ? readFileSync(manifestPath) : null });
  if (mode === 'preflight') { console.log(JSON.stringify({ mode: 'preflight', accepted: false, outstanding: failures }, null, 2)); process.exit(0); }
  if (failures.length > 0) { console.log(JSON.stringify({ mode: 'checkpoint', accepted: false, failures }, null, 2)); process.exit(1); }
  console.log(JSON.stringify({ mode: 'checkpoint', accepted: true, checkpoint: 'L5-MEMORY-V1', tupleSha256: doc.tupleSha256 }, null, 2));
}
