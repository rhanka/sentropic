#!/usr/bin/env node
// Release receipt verdict (BR-82): the CD joins only tested bytes.
// Pure assessment over caller-supplied evidence: rejects missing/failed/
// cancelled/skipped required checks, wrong source/digest, missing publication,
// tag collision, mismatched registry integrity/provenance, and stale receipt
// reuse. Runs behind root Make targets in $(LLM_MESH_NODE_IMAGE); never on the host.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const DIGEST = /^sha256:[a-f0-9]{64}$/;

function publicationLabel(publication) {
  const ref = publication.ref ?? publication.version;
  return ref === undefined ? publication.name : `${publication.name}@${ref}`;
}

function checkProblems(required, observed) {
  const problems = [];
  const byJob = new Map((observed ?? []).map((row) => [row?.job, row?.conclusion]));
  for (const { job } of required ?? []) {
    if (!byJob.has(job)) {
      problems.push(`missing required check: ${job}`);
    } else if (byJob.get(job) !== 'success') {
      problems.push(`required check ${job} concluded ${byJob.get(job)}`);
    }
  }
  return problems;
}

function publicationProblems(publication, source) {
  const label = publicationLabel(publication);
  if (publication.expected !== true) return [];
  if (publication.status === 'failed') return [`publication failed: ${label}`];
  if (publication.status !== 'published') return [`missing publication: ${label}`];
  const problems = [];
  if (publication.kind === 'package' && publication.pack !== 'candidate') {
    problems.push(`repacked publication: ${label} (pack=${publication.pack ?? 'missing'}, expected candidate)`);
  }
  if (publication.source !== source.sha) problems.push(`wrong source for ${label}: ${publication.source} (expected ${source.sha})`);
  if (publication.digest !== undefined) {
    if (!DIGEST.test(publication.digest)) {
      problems.push(`invalid digest for ${label}: ${publication.digest}`);
    } else {
      if (publication.expectedDigest !== undefined && publication.digest !== publication.expectedDigest) {
        problems.push(`digest mismatch for ${label}: published ${publication.digest}, tested ${publication.expectedDigest}`);
      }
      if (publication.remoteDigest !== undefined && publication.remoteDigest !== publication.digest) {
        problems.push(`tag collision for ${label}: registry holds ${publication.remoteDigest}, tested ${publication.digest}`);
      }
    }
  }
  if (publication.integrity !== undefined && publication.registryIntegrity !== undefined
    && publication.integrity !== publication.registryIntegrity) {
    problems.push(`mismatched registry integrity for ${label}: ${publication.registryIntegrity} != ${publication.integrity}`);
  }
  if (publication.provenance !== undefined) {
    const { sourceCommits = [], runId } = publication.provenance;
    if (!sourceCommits.includes(source.sha)) problems.push(`mismatched provenance source for ${label}: ${sourceCommits.join(',') || 'none'}`);
    if (runId !== undefined && runId !== source.runId) problems.push(`stale provenance run for ${label}: ${runId} (expected ${source.runId})`);
  }
  return problems;
}

// A reused prior receipt is only valid for the same source, run and attempt:
// anything else is a stale receipt qualifying bytes this run never tested.
function priorProblems(prior, source) {
  if (prior === undefined || prior === null) return [];
  if (prior.sourceSha !== source.sha || prior.runId !== source.runId || prior.attempt !== source.attempt) {
    return [`stale receipt reuse: prior ${prior.sourceSha}@${prior.runId}/${prior.attempt} != ${source.sha}@${source.runId}/${source.attempt}`];
  }
  return [];
}

export function assessReleaseReceipt(evidence = {}) {
  const source = evidence.source ?? {};
  const problems = [
    ...checkProblems(evidence.requiredChecks, evidence.checks),
    ...(evidence.publications ?? []).flatMap((publication) => publicationProblems(publication, source)),
    ...priorProblems(evidence.prior, source),
  ];
  const summary = problems.length === 0 ? 'release-receipt: PASS' : `release-receipt: FAIL (${problems.length}): ${problems.join('; ')}`;
  return { ok: problems.length === 0, problems, summary };
}

// Delivery-chain assessment for the release-receipts CI job: maps workflow
// needs results plus change selections onto the release evidence above.
// Images carry status/source only (digest verification already happens at
// transport load, collision-safe push, and deploy-time manifest checks);
// package publications additionally record the qualified sha256 and pack
// source (candidate vs fresh) from their recorded publish receipts.
const CHAIN_DELIVERY = [
  { job: 'publish-api-image', kind: 'image', name: 'sentropic-api', selected: (s) => s.api === true || s.global === true, tag: (s) => s.apiTag },
  { job: 'publish-ui-image', kind: 'image', name: 'sentropic-ui', selected: (s) => s.ui === true || s.global === true, tag: (s) => s.uiTag },
  { job: 'publish-llm-mesh', kind: 'package', name: '@sentropic/llm-mesh', selected: (s) => s.meshPublish === true },
  { job: 'publish-llm-gateway', kind: 'package', name: '@sentropic/llm-gateway', selected: (s) => s.gatewayPublish === true },
  { job: 'publish-cluster-mesh', kind: 'package', name: '@sentropic/cluster-mesh', selected: (s) => s.clusterPublish === true },
];
const chainStatus = (result) => result === 'success' ? 'published' : result === 'skipped' ? 'skipped' : 'failed';

export function assessChain({ needs = {}, selections = {}, source = {} } = {}) {
  const sel = { api: false, ui: false, global: false, meshPublish: false, gatewayPublish: false, clusterPublish: false, ...selections };
  const requiredChecks = [];
  const checks = [];
  const publications = [];
  for (const { job, kind, name, selected, tag } of CHAIN_DELIVERY) {
    const expected = selected(sel) === true;
    const outputs = needs[job]?.outputs ?? {};
    if (expected) requiredChecks.push({ job });
    checks.push({ job, conclusion: needs[job]?.result });
    const publication = { kind, name, expected, source: source.sha, status: chainStatus(needs[job]?.result) };
    const ref = tag?.(sel) ?? outputs.version;
    if (ref) publication.ref = ref;
    if (outputs.sha256 !== undefined) {
      publication.sha256 = outputs.sha256;
      // The recorded hex sha becomes the evidence digest only in canonical
      // form; anything else fails the digest check below instead of passing
      // silently.
      publication.digest = /^[a-f0-9]{64}$/.test(outputs.sha256) ? `sha256:${outputs.sha256}` : outputs.sha256;
    }
    const pack = outputs.pack ?? outputs.publication_pack;
    if (pack !== undefined) publication.pack = pack;
    if (outputs.status) publication.receiptStatus = outputs.status;
    publications.push(publication);
  }
  // The train-lock check keeps its independent BRDP-EX10 verdict: no chain job
  // may list it in needs, so its result reaches this receipt only when the
  // caller supplies it (a missing lock entry never blocks the publisher join).
  if (needs['verify-train-lock-integrity'] !== undefined) {
    const conclusion = needs['verify-train-lock-integrity']?.result;
    checks.push({ job: 'verify-train-lock-integrity', conclusion });
    if ((sel.meshPublish === true || sel.gatewayPublish === true) && conclusion !== 'success') {
      requiredChecks.push({ job: 'verify-train-lock-integrity' });
    }
  }
  const evidence = { source, requiredChecks, checks, publications, prior: null };
  return { ...assessReleaseReceipt(evidence), evidence };
}

const argValue = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const isTrue = (value) => value === 'true' || value === true;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const outFile = argValue(argv, '--out') ?? 'release-receipt.json';
  const fail = (verdict, evidence) => {
    fs.writeFileSync(outFile, `${JSON.stringify({ ...verdict, evidence }, null, 2)}\n`);
    process.stdout.write(`${verdict.summary}\n`);
    if (!verdict.ok) {
      for (const problem of verdict.problems) process.stderr.write(`::error::release-receipt: ${problem}\n`);
      process.exit(1);
    }
  };
  if (argv[0] === 'assess') {
    const evidenceFile = argValue(argv, '--evidence');
    if (!evidenceFile) {
      process.stderr.write('::error::release-receipt: --evidence <file> is required\n');
      process.exit(2);
    }
    let evidence;
    try {
      evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    } catch (error) {
      process.stderr.write(`::error::release-receipt: unreadable evidence ${evidenceFile}: ${error.message}\n`);
      process.exit(2);
    }
    fail(assessReleaseReceipt(evidence), evidence);
  } else if (argv[0] === 'assess-chain') {
    const needsFile = argValue(argv, '--needs');
    if (!needsFile) {
      process.stderr.write('::error::release-receipt: --needs <file> is required\n');
      process.exit(2);
    }
    let needs;
    try {
      needs = JSON.parse(fs.readFileSync(needsFile, 'utf8'));
    } catch (error) {
      process.stderr.write(`::error::release-receipt: unreadable needs ${needsFile}: ${error.message}\n`);
      process.exit(2);
    }
    const source = { sha: argValue(argv, '--sha'), runId: argValue(argv, '--run-id'), attempt: argValue(argv, '--attempt') };
    const selections = {
      api: isTrue(argValue(argv, '--api')), ui: isTrue(argValue(argv, '--ui')), global: isTrue(argValue(argv, '--global')),
      meshPublish: isTrue(argValue(argv, '--mesh-publish')), gatewayPublish: isTrue(argValue(argv, '--gateway-publish')),
      clusterPublish: isTrue(argValue(argv, '--cluster-publish')),
      apiTag: argValue(argv, '--api-tag'), uiTag: argValue(argv, '--ui-tag'),
    };
    const verdict = assessChain({ needs, selections, source });
    fail(verdict, verdict.evidence);
  } else {
    process.stderr.write('Usage: release-receipt.mjs assess --evidence <file> [--out <file>]\n     release-receipt.mjs assess-chain --needs <file> --sha <sha> --run-id <id> --attempt <n> [--out <file>]\n       --api/--ui/--global/--mesh-publish/--gateway-publish/--cluster-publish true|false [--api-tag T] [--ui-tag T]\n');
    process.exit(2);
  }
}
