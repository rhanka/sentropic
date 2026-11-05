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
  return `${publication.name}@${publication.ref ?? publication.version ?? 'unknown'}`;
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

const argValue = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv[0] !== 'assess') {
    process.stderr.write('Usage: release-receipt.mjs assess --evidence <file> [--out <file>]\n');
    process.exit(2);
  }
  const evidenceFile = argValue(argv, '--evidence');
  const outFile = argValue(argv, '--out') ?? 'release-receipt.json';
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
  const verdict = assessReleaseReceipt(evidence);
  fs.writeFileSync(outFile, `${JSON.stringify({ ...verdict, evidence }, null, 2)}\n`);
  process.stdout.write(`${verdict.summary}\n`);
  if (!verdict.ok) {
    for (const problem of verdict.problems) process.stderr.write(`::error::release-receipt: ${problem}\n`);
    process.exit(1);
  }
}
