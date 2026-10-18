// schema-validator.mjs — Closed JSON Schema draft-2020-12 validator & on-disk evidence verifier for L5-MEMORY-V1.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const sha512Integrity = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

export function canonicalizeJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalizeJson(v)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalizeJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function computeTupleSha256(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const { phase, source, contracts, preCandidate, artifacts, closure, runtime, assurance } = doc;
  return sha256Hex(Buffer.from(canonicalizeJson({ phase, source, contracts, preCandidate, artifacts, closure, runtime, assurance })));
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
    for (const req of node.required || []) if (!(req in value)) failures.push(`${path}: missing required property ${req}`);
    if (node.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in props)) failures.push(`${path}: additional property ${k} forbidden`);
    }
    for (const [k, propSchema] of Object.entries(props)) {
      if (k in value) failures.push(...validateAgainstSchema(value[k], rootSchema, propSchema, `${path}.${k}`));
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
    if (expectedSha && sha256Hex(bytes) !== expectedSha) { failures.push(`${label}: sha256 mismatch for ${relPath}`); return null; }
    return bytes;
  };
  const readJson = (ref, label) => {
    const bytes = ref ? readChecked(ref.path, ref.sha256, label) : null;
    if (!bytes) return null;
    try { return JSON.parse(bytes.toString('utf8')); } catch { failures.push(`${label}: invalid JSON in ${ref.path}`); return null; }
  };
  const c = doc.contracts || {}, pre = doc.preCandidate || {}, closure = doc.closure || {};
  for (const k of ['l0Freeze', 'entry', 'providerManifest']) readChecked(c[k]?.path, c[k]?.sha256, `contracts.${k}`);
  for (const listKey of ['fixtures', 'exports', 'schemas', 'profiles']) {
    for (const item of c[listKey] || []) readChecked(item?.path, item?.sha256, `contracts.${listKey}/${item?.path}`);
  }
  const retainedInv = Array.isArray(pre.contractInventory) ? pre.contractInventory : readJson(pre.contractInventory, 'preCandidate.contractInventory')?.contractInventory;
  if (!Array.isArray(retainedInv) || retainedInv.length === 0) failures.push('preCandidate.contractInventory: missing contractInventory entries');
  for (const item of retainedInv || []) {
    const retainedBytes = readChecked(`retained/${item.path}`, item.sha256, `preCandidate.retained/${item.path}`);
    const qualifiedBytes = readChecked(item.path, item.sha256, `preCandidate.qualified/${item.path}`);
    if (retainedBytes && qualifiedBytes && Buffer.compare(retainedBytes, qualifiedBytes) !== 0) failures.push(`preCandidate.contractInventory: byte mismatch on ${item.path}`);
  }
  const l4Artifact = (doc.artifacts || []).find((a) => a && a.role === 'l4');
  const l4Receipt = readJson(pre.l4BuildReceipt, 'preCandidate.l4BuildReceipt');
  if (!l4Receipt || l4Receipt.builtAgainstPreCandidateSha256 !== pre.manifestSha256 || !l4Artifact || l4Receipt.e4ArtifactSha256 !== l4Artifact.sha256 || l4Receipt.sourceHead !== l4Artifact.sourceHead) {
    failures.push('preCandidate.l4BuildReceipt: invalid E4 build binding');
  }
  const compDoc = readJson(pre.contractComparison, 'preCandidate.contractComparison');
  if (!compDoc || compDoc.identical !== true || compDoc.preCandidateManifestSha256 !== pre.manifestSha256 || compDoc.candidateManifestSha256 !== closure.artifactManifestSha256 || JSON.stringify(compDoc.contracts) !== JSON.stringify(retainedInv)) {
    failures.push('preCandidate.contractComparison: invalid comparison record');
  }
  for (const a of doc.artifacts || []) {
    const bytes = readChecked(a.archiveRef, a.sha256, `artifacts/${a.name}`);
    if (bytes && sha512Integrity(bytes) !== a.integrity) failures.push(`artifacts/${a.name}: sha512 integrity mismatch`);
  }
  const graphDoc = readJson(doc.importGraph, 'importGraph');
  if (!graphDoc || graphDoc.forbiddenHits !== 0 || graphDoc.unresolvedEdges !== 0 || graphDoc.resolvedFilesSha256 !== doc.importGraph?.resolvedFilesSha256 || JSON.stringify(graphDoc.roots) !== JSON.stringify(catalog.importGraphRoots)) {
    failures.push('importGraph: on-disk report mismatch');
  }
  for (const p of doc.proofs || []) {
    const cat = (catalog.proofs || []).find((x) => x.id === p.id);
    const rep = readJson(p.result, `proofs/${p.id}.result`);
    if (!cat || !rep || rep.success !== true || rep.numPassedTests !== p.result?.passed || rep.numFailedTests !== 0 || rep.numPendingTests !== 0 || rep.numTodoTests !== 0 || !Array.isArray(rep.testResults)) {
      failures.push(`proofs/${p.id}: invalid on-disk vitest report`); continue;
    }
    const executed = [], fileSet = new Set();
    for (const tr of rep.testResults) {
      if (tr?.status === 'passed' && typeof tr.name === 'string') fileSet.add(tr.name);
      for (const ar of tr?.assertionResults || []) {
        if (ar?.status !== 'passed') failures.push(`proofs/${p.id}: non-passed assertion ${ar?.fullName || ar?.title}`);
        else executed.push({ file: tr.name, caseId: ar.fullName || ar.title, status: 'passed' });
      }
    }
    for (const reqFile of cat.files) if (!fileSet.has(reqFile)) failures.push(`proofs/${p.id}: missing executed file ${reqFile}`);
    const caseIds = new Set(executed.map((e) => e.caseId));
    for (const reqCase of cat.requiredCases) if (!caseIds.has(reqCase)) failures.push(`proofs/${p.id}: missing required case ${reqCase}`);
    if (sha256Hex(Buffer.from(canonicalizeJson(executed))) !== p.result?.executedCasesSha256) failures.push(`proofs/${p.id}: executedCasesSha256 mismatch`);
  }
  const uatDoc = readJson(doc.ownerUat?.evidence, 'ownerUat.evidence');
  if (!uatDoc || uatDoc.tupleSha256 !== doc.tupleSha256 || uatDoc.status !== doc.ownerUat?.status || uatDoc.actorRef !== doc.ownerUat?.actorRef || uatDoc.recordedAt !== doc.ownerUat?.recordedAt || (doc.ownerUat?.status === 'passed' ? uatDoc.policySha256 !== doc.ownerUat?.policySha256 : uatDoc.owningLot !== doc.ownerUat?.owningLot || uatDoc.reason !== doc.ownerUat?.reason)) {
    failures.push('ownerUat.evidence: on-disk decision mismatch');
  }
  for (const a of doc.acceptances || []) {
    const accDoc = readJson(a.evidence, `acceptances/${a.role}.evidence`);
    if (!accDoc || accDoc.role !== a.role || accDoc.actorRef !== a.actorRef || accDoc.tupleSha256 !== doc.tupleSha256 || accDoc.verdict !== 'accepted') failures.push(`acceptances/${a.role}: on-disk disposition mismatch`);
  }
  return failures;
}
