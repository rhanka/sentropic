// schema-validator.mjs — Closed JSON Schema draft-2020-12 validator & on-disk evidence verifier for L5-MEMORY-V1.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const sha512Integrity = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
export const CHECKPOINT_SCHEMA_SHA256 = sha256Hex(readFileSync(resolve(HERE, 'schemas/checkpoint-v1.schema.json')));
export const ARTIFACT_MANIFEST_SCHEMA_SHA256 = sha256Hex(readFileSync(resolve(HERE, 'schemas/artifact-manifest-v1.schema.json')));
export const PROOF_CATALOG_SHA256 = sha256Hex(readFileSync(resolve(HERE, 'proof-catalog-v1.json')));
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const asArr = (v) => (Array.isArray(v) ? v : []);

export function canonicalizeJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalizeJson(v)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalizeJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function computeTupleSha256(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const { phase, source, contracts, preCandidate, artifacts, closure, runtime, assurance } = doc;
  const definitionDigests = {
    checkpointSchemaSha256: CHECKPOINT_SCHEMA_SHA256,
    artifactManifestSchemaSha256: ARTIFACT_MANIFEST_SCHEMA_SHA256,
    proofCatalogSha256: PROOF_CATALOG_SHA256,
  };
  return sha256Hex(Buffer.from(canonicalizeJson({ phase, source, contracts, preCandidate, artifacts, closure, runtime, assurance, definitionDigests })));
}

export function validateAgainstSchema(value, rootSchema, node = rootSchema, path = '$') {
  if (!node || typeof node !== 'object') return [];
  if (node.$ref) {
    const refName = node.$ref.replace(/^#\/\$defs\//, '');
    const target = rootSchema.$defs && rootSchema.$defs[refName];
    return target ? validateAgainstSchema(value, rootSchema, target, path) : [`${path}: unresolved $ref ${node.$ref}`];
  }
  const failures = [];
  if (node.oneOf) {
    const branchErrors = node.oneOf.map((branch) => validateAgainstSchema(value, rootSchema, branch, path));
    const matches = branchErrors.filter((errs) => errs.length === 0);
    if (matches.length !== 1) failures.push(`${path}: must match exactly one oneOf branch (matched ${matches.length}): ${branchErrors.flat().join('; ')}`);
    return failures;
  }
  if (node.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected object`];
    const props = node.properties || {};
    if (node.additionalProperties === false && Object.getPrototypeOf(value) !== Object.prototype) {
      failures.push(`${path}: additional property __proto__ forbidden`);
    }
    for (const req of node.required || []) if (!hasOwn(value, req)) failures.push(`${path}: missing required property ${req}`);
    if (node.additionalProperties === false) {
      for (const k of Object.getOwnPropertyNames(value)) if (!hasOwn(props, k)) failures.push(`${path}: additional property ${k} forbidden`);
    }
    for (const [k, propSchema] of Object.entries(props)) {
      if (hasOwn(value, k)) failures.push(...validateAgainstSchema(value[k], rootSchema, propSchema, `${path}.${k}`));
    }
    return failures;
  }
  if (node.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (node.minItems !== undefined && value.length < node.minItems) failures.push(`${path}: minItems ${node.minItems} violated`);
    if (node.maxItems !== undefined && value.length > node.maxItems) failures.push(`${path}: maxItems ${node.maxItems} violated`);
    if (node.items) value.forEach((item, idx) => failures.push(...validateAgainstSchema(item, rootSchema, node.items, `${path}[${idx}]`)));
    return failures;
  }
  if (node.type === 'string') {
    if (typeof value !== 'string') return [`${path}: expected string`];
    if (node.minLength !== undefined && value.length < node.minLength) failures.push(`${path}: minLength ${node.minLength} violated`);
    if (node.maxLength !== undefined && value.length > node.maxLength) failures.push(`${path}: maxLength ${node.maxLength} violated`);
    if (node.pattern && !new RegExp(node.pattern).test(value)) failures.push(`${path}: pattern mismatch`);
    if (node.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) || Number.isNaN(Date.parse(value)))) {
      failures.push(`${path}: invalid date-time format`);
    }
  } else if (node.type === 'integer') {
    if (!Number.isInteger(value)) return [`${path}: expected integer`];
    if (node.minimum !== undefined && value < node.minimum) failures.push(`${path}: minimum ${node.minimum} violated`);
    if (node.maximum !== undefined && value > node.maximum) failures.push(`${path}: maximum ${node.maximum} violated`);
  } else if (node.type === 'boolean' && typeof value !== 'boolean') {
    return [`${path}: expected boolean`];
  }
  if (node.const !== undefined && value !== node.const) failures.push(`${path}: must equal ${JSON.stringify(node.const)}`);
  if (node.enum && !node.enum.includes(value)) failures.push(`${path}: must be one of ${JSON.stringify(node.enum)}`);
  return failures;
}

export function verifyOnDiskEvidence(doc, catalog, options = {}) {
  const baseDir = options.baseDir;
  if (typeof baseDir !== 'string' || baseDir.length === 0) return ['evidence: baseDir is required to verify on-disk proof files'];
  const failures = [], rootDir = resolve(baseDir);
  const readChecked = (relPath, expectedSha, label) => {
    if (typeof relPath !== 'string' || relPath.length === 0) { failures.push(`${label}: missing path`); return null; }
    const abs = resolve(rootDir, relPath), rel = relative(rootDir, abs);
    if (rel.startsWith('..') || rel.startsWith('/') || !existsSync(abs)) { failures.push(`${label}: missing on-disk file ${relPath}`); return null; }
    const bytes = readFileSync(abs);
    if (!expectedSha || sha256Hex(bytes) !== expectedSha) { failures.push(`${label}: sha256 mismatch for ${relPath}`); return null; }
    return bytes;
  };
  const readJson = (ref, label) => {
    const bytes = ref ? readChecked(ref.path, ref.sha256, label) : null;
    if (!bytes) return null;
    try { return JSON.parse(bytes.toString('utf8')); } catch { failures.push(`${label}: invalid JSON in ${ref.path}`); return null; }
  };
  const src = doc.source || {}, c = doc.contracts || {}, pre = doc.preCandidate || {}, closure = doc.closure || {};
  readChecked('receipts/source-tree.json', src.sourceTreeSha256, 'source.sourceTreeSha256');
  readChecked('packages/mcp-platform/dist/registry.d.ts', c.registrySha256, 'contracts.registrySha256');
  readChecked('packages/cluster-mesh/dist/compose/mcp.d.ts', c.gatewaySha256, 'contracts.gatewaySha256');
  const freezeDoc = readJson(c.l0Freeze, 'contracts.l0Freeze');
  if (!freezeDoc || freezeDoc.specSha256 !== c.specSha256 || freezeDoc.l0Commit !== c.l0Commit || freezeDoc.checkpointSchemaSha256 !== CHECKPOINT_SCHEMA_SHA256 || freezeDoc.artifactManifestSchemaSha256 !== ARTIFACT_MANIFEST_SCHEMA_SHA256 || freezeDoc.proofCatalogSha256 !== PROOF_CATALOG_SHA256) {
    failures.push('contracts.l0Freeze: freeze metadata or schema/catalog hash mismatch');
  }
  for (const reqFix of asArr(catalog.immutableFixtures)) {
    const entry = asArr(freezeDoc?.immutableFixtures).find((f) => f && f.path === reqFix);
    readChecked(reqFix, entry?.sha256, `immutableFixtures/${reqFix}`);
  }
  for (const k of ['entry', 'providerManifest']) readChecked(c[k]?.path, c[k]?.sha256, `contracts.${k}`);
  for (const listKey of ['fixtures', 'exports', 'schemas', 'profiles']) {
    for (const item of asArr(c[listKey])) readChecked(item?.path, item?.sha256, `contracts.${listKey}/${item?.path}`);
  }
  const retainedInv = asArr(pre.contractInventory);
  if (retainedInv.length === 0) failures.push('preCandidate.contractInventory: missing contractInventory entries');
  for (const item of retainedInv) {
    const retainedBytes = readChecked(`retained/${item?.path}`, item?.sha256, `preCandidate.retained/${item?.path}`);
    const qualifiedBytes = readChecked(item?.path, item?.sha256, `preCandidate.qualified/${item?.path}`);
    if (retainedBytes && qualifiedBytes && Buffer.compare(retainedBytes, qualifiedBytes) !== 0) failures.push(`preCandidate.contractInventory: byte mismatch on ${item?.path}`);
  }
  const l4Artifact = asArr(doc.artifacts).find((a) => a && a.role === 'l4');
  const l4Receipt = readJson(pre.l4BuildReceipt, 'preCandidate.l4BuildReceipt');
  if (!l4Receipt || l4Receipt.builtAgainstPreCandidateSha256 !== pre.manifestSha256 || !l4Artifact || l4Receipt.e4ArtifactSha256 !== l4Artifact.sha256 || l4Receipt.sourceHead !== l4Artifact.sourceHead) {
    failures.push('preCandidate.l4BuildReceipt: invalid E4 build binding');
  }
  const compDoc = readJson(pre.contractComparison, 'preCandidate.contractComparison');
  if (!compDoc || compDoc.identical !== true || compDoc.preCandidateManifestSha256 !== pre.manifestSha256 || compDoc.candidateManifestSha256 !== closure.artifactManifestSha256 || JSON.stringify(compDoc.contracts) !== JSON.stringify(retainedInv)) {
    failures.push('preCandidate.contractComparison: invalid comparison record');
  }
  for (const a of asArr(doc.artifacts)) {
    const bytes = readChecked(a?.archiveRef, a?.sha256, `artifacts/${a?.name}`);
    if (bytes && sha512Integrity(bytes) !== a?.integrity) failures.push(`artifacts/${a?.name}: sha512 integrity mismatch`);
  }
  const rt = doc.runtime || {}, assurance = doc.assurance || {}, ci = doc.ci || {};
  readChecked('package-lock.json', closure.declaredLockSha256, 'closure.declaredLockSha256');
  readChecked('receipts/installed-lock.json', closure.installedLockSha256, 'closure.installedLockSha256');
  const instClosure = readJson({ path: 'receipts/installed-closure.json', sha256: closure.installedClosureSha256 }, 'closure.installedClosureSha256');
  if (!instClosure || instClosure.artifactManifestSha256 !== closure.artifactManifestSha256 || instClosure.sdkVersion !== closure.sdkVersion || instClosure.referenceExport !== closure.referenceExport) {
    failures.push('closure.installedClosureSha256: closure report mismatch');
  }
  readChecked('packages/mcp-broker/dist/memory-reference/index.js', closure.referenceSourceSha256, 'closure.referenceSourceSha256');
  readChecked('tools/memory-mcp-l5/policies/sqlite-fence-profile-v1.json', rt.fenceProfileSha256, 'runtime.fenceProfileSha256');
  let probeRaw = null;
  try { probeRaw = JSON.parse(readFileSync(resolve(rootDir, 'receipts/runtime-probe.json'), 'utf8')); } catch { probeRaw = null; }
  if (!probeRaw || probeRaw.nodeVersion !== rt.nodeVersion || probeRaw.imageDigest !== rt.imageDigest || probeRaw.sqliteVersion !== rt.sqliteVersion || probeRaw.driver !== 'node:sqlite' || probeRaw.journalMode !== 'WAL' || probeRaw.synchronous !== 'FULL' || probeRaw.fenceProfileSha256 !== rt.fenceProfileSha256 || probeRaw.pythonCount !== 0 || probeRaw.addonBuildCount !== 0) {
    failures.push('runtime: on-disk runtime-probe.json mismatch');
  }
  readChecked('tools/memory-mcp-l5/policies/sent-tech-assurance-v1.json', assurance.productionPolicySha256, 'assurance.productionPolicySha256');
  readChecked('tools/memory-mcp-l5/policies/qualification-assurance-v1.json', assurance.qualificationPolicySha256, 'assurance.qualificationPolicySha256');
  readChecked('tools/memory-mcp-l5/verifier.mjs', assurance.verifierArtifactSha256, 'assurance.verifierArtifactSha256');
  readChecked('tools/memory-mcp-l5/policies/trust-profile-v1.json', assurance.trustProfileSha256, 'assurance.trustProfileSha256');
  const graphDoc = readJson(doc.importGraph, 'importGraph');
  const resFiles = asArr(graphDoc?.resolvedFiles);
  if (!graphDoc || graphDoc.forbiddenHits !== 0 || graphDoc.unresolvedEdges !== 0 || resFiles.length !== asArr(catalog.importGraphRoots).length || sha256Hex(Buffer.from(canonicalizeJson(resFiles))) !== doc.importGraph?.resolvedFilesSha256 || JSON.stringify(graphDoc.roots) !== JSON.stringify(catalog.importGraphRoots)) {
    failures.push('importGraph: on-disk report mismatch');
  }
  for (const rf of resFiles) readChecked(rf?.path, rf?.sha256, `importGraph.resolvedFiles/${rf?.root}`);
  const normPath = (fp) => {
    if (typeof fp !== 'string') return '';
    const s = fp.replace(/\\/g, '/'), rp = `${rootDir.replace(/\\/g, '/')}/`;
    if (s.startsWith(rp)) return s.slice(rp.length);
    const i = s.search(/(?:^|\/)(packages|tools)\//);
    return i >= 0 ? s.slice(s[i] === '/' ? i + 1 : i) : s;
  };
  for (const p of asArr(doc.proofs)) {
    const cat = asArr(catalog.proofs).find((x) => x.id === p?.id);
    const rep = readJson(p?.result, `proofs/${p?.id}.result`);
    if (!cat || !rep || rep.success !== true || rep.runId !== p.runId || rep.attempt !== p.attempt || rep.sourceHead !== p.sourceHead || rep.artifactManifestSha256 !== p.artifactManifestSha256 || rep.numPassedTests !== p.result?.passed || rep.numTotalTests !== p.result?.passed || rep.numFailedTests !== 0 || rep.numPendingTests !== 0 || rep.numTodoTests !== 0 || !Array.isArray(rep.testResults)) {
      failures.push(`proofs/${p?.id}: invalid on-disk vitest report`); continue;
    }
    const executed = [], fileSet = new Set();
    for (const tr of rep.testResults) {
      const nf = normPath(tr?.name), ars = asArr(tr?.assertionResults);
      if (!cat.files.includes(nf) || fileSet.has(nf)) failures.push(`proofs/${p.id}: unlisted file ${nf}`);
      if (tr?.status !== 'passed' || ars.length === 0) failures.push(`proofs/${p.id}: empty assertions in ${nf}`);
      fileSet.add(nf);
      for (const ar of ars) {
        if (ar?.status !== 'passed') failures.push(`proofs/${p.id}: non-passed assertion ${ar?.fullName || ar?.title}`);
        else executed.push({ file: nf, caseId: ar.fullName || ar.title, status: 'passed' });
      }
      for (const reqCase of asArr(cat.fileCases?.[nf])) {
        if (!ars.some((ar) => ar?.status === 'passed' && (ar.title === reqCase || ar.fullName === reqCase || String(ar.title || '').includes(reqCase) || String(ar.fullName || '').includes(reqCase)))) {
          failures.push(`proofs/${p.id}: missing required case ${reqCase} in ${nf}`);
        }
      }
    }
    if (executed.length !== p.result?.passed) failures.push(`proofs/${p.id}: assertion count mismatch`);
    for (const reqFile of cat.files) if (!fileSet.has(reqFile)) failures.push(`proofs/${p.id}: missing executed file ${reqFile}`);
    for (const reqCase of cat.requiredCases) if (!executed.some((e) => e.caseId === reqCase || String(e.caseId || '').includes(reqCase))) failures.push(`proofs/${p.id}: missing required case ${reqCase}`);
    if (sha256Hex(Buffer.from(canonicalizeJson(executed))) !== p.result?.executedCasesSha256) failures.push(`proofs/${p.id}: executedCasesSha256 mismatch`);
  }
  let ciRun = null;
  try { ciRun = JSON.parse(readFileSync(resolve(rootDir, 'receipts/ci-run.json'), 'utf8')); } catch { ciRun = null; }
  if (!ciRun || ciRun.workflow !== ci.workflow || ciRun.status !== 'completed' || ciRun.conclusion !== 'success' || ciRun.runId !== ci.runId || ciRun.attempt !== ci.attempt || ciRun.head !== ci.head || ciRun.tupleSha256 !== doc.tupleSha256) {
    failures.push('ci: on-disk ci-run.json mismatch');
  }
  for (const j of asArr(ci.jobs)) {
    const jDoc = readJson({ path: `receipts/ci-job-${j?.id}.json`, sha256: j?.resultSha256 }, `ci.jobs/${j?.id}`);
    if (!jDoc || jDoc.jobId !== j?.id || jDoc.runId !== ci.runId || jDoc.attempt !== ci.attempt || jDoc.head !== ci.head || jDoc.tupleSha256 !== doc.tupleSha256 || jDoc.conclusion !== 'success' || (j?.id === 'memory-l5-qualification' && JSON.stringify(jDoc.proofResultSha256s) !== JSON.stringify(asArr(doc.proofs).map((p) => ({ id: p?.id, sha256: p?.result?.sha256 }))))) {
      failures.push(`ci.jobs/${j?.id}: on-disk job evidence mismatch`);
    }
  }
  if (!asArr(catalog.authorizedOwners?.ownerUat).includes(doc.ownerUat?.actorRef) || !asArr(freezeDoc?.authorizedOwners?.ownerUat).includes(doc.ownerUat?.actorRef)) failures.push('ownerUat: unauthorized actorRef');
  const uatDoc = readJson(doc.ownerUat?.evidence, 'ownerUat.evidence');
  if (!uatDoc || uatDoc.tupleSha256 !== doc.tupleSha256 || uatDoc.authoritySourceSha256 !== c.l0Freeze?.sha256 || uatDoc.ciRunId !== ci.runId || uatDoc.status !== doc.ownerUat?.status || uatDoc.actorRef !== doc.ownerUat?.actorRef || uatDoc.recordedAt !== doc.ownerUat?.recordedAt || (doc.ownerUat?.status === 'passed' ? uatDoc.policySha256 !== doc.ownerUat?.policySha256 || doc.ownerUat?.policySha256 !== assurance.productionPolicySha256 : uatDoc.owningLot !== doc.ownerUat?.owningLot || uatDoc.reason !== doc.ownerUat?.reason)) {
    failures.push('ownerUat.evidence: on-disk decision mismatch');
  }
  for (const a of asArr(doc.acceptances)) {
    if (!asArr(catalog.authorizedOwners?.acceptances?.[a?.role]).includes(a?.actorRef) || !asArr(freezeDoc?.authorizedOwners?.acceptances?.[a?.role]).includes(a?.actorRef)) failures.push(`acceptances/${a?.role}: unauthorized actorRef`);
    const accDoc = readJson(a?.evidence, `acceptances/${a?.role}.evidence`);
    if (!accDoc || accDoc.role !== a?.role || accDoc.actorRef !== a?.actorRef || accDoc.tupleSha256 !== doc.tupleSha256 || accDoc.authoritySourceSha256 !== c.l0Freeze?.sha256 || accDoc.ciRunId !== ci.runId || accDoc.verdict !== 'accepted') failures.push(`acceptances/${a?.role}: on-disk disposition mismatch`);
  }
  return failures;
}
