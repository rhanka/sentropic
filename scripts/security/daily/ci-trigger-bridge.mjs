// T5-C5 / L3-G / L3-M (r6 §7.3, §4.2.1, §6.3): the bot-PR trigger/check bridge.
// A workflow-token-authored PR receives exactly one explicitly dispatched complete
// required CI on exact H/B/T through the fixed security-required-ci.yml entry with
// zero release effects. The late-receipt gate binds the exact packed/installed
// artifact (one copy, admitted range). Production-credential acquisition is allowed
// only from protected main through a trusted control workflow and actor; A13 stays
// source-gap until that is proved on a real run.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_CI_WORKFLOW = '.github/workflows/security-required-ci.yml';
export const POST_MERGE_WORKFLOW = '.github/workflows/security-post-merge.yml';

// r6 §4.2.1 release-effect job set of ci.yml: every publish-* job, the preprod
// deploy and the train-lock verification. bootstrap-publish is the closed manual
// bootstrap and is NOT an automatic release effect.
export const RELEASE_EFFECT_JOB_PATTERN = /^(publish-[a-z0-9-]+|deploy-preprod|verify-train-lock-integrity)$/;

// Protected trusted acquisition workflows for production credentials (N9). Ordinary
// CI is never a trusted acquisition path; hostile same-repo PR refs and candidate
// checkouts refuse.
export const TRUSTED_ACQUISITION_WORKFLOWS = [
  '.github/workflows/security-report-control.yml',
  '.github/workflows/security-scanner-image.yml',
];
export const TRUSTED_ACQUISITION_ACTOR = 'trusted-control';

// A13 (production backup credential) is not proved on any real run yet.
export const A13_STATUS = 'source-gap';

// Digests in this bridge are lowercase 64-char; an uppercase-forged producer
// digest is spoofed, not merely malformed.
const HEX64 = /^[0-9a-z]{64}$/;

export function isBotAuthoredPr(pr) {
  return pr.authorType === 'Bot' || pr.author === 'github-actions[bot]';
}

// Minimal structural scan of a workflow's `on:` block and job ids — no YAML
// dependency in the pinned key-free lane.
function parseWorkflow(text) {
  const lines = text.split('\n');
  let pushMain = false;
  let pathFilter = null;
  let manualOnly = false;
  const events = new Set();
  let inOn = false;
  let currentEvent = null;
  let inPushPaths = false;
  const paths = [];
  let inJobs = false;
  const jobs = [];
  for (const line of lines) {
    if (/^on:/.test(line)) { inOn = true; inJobs = false; continue; }
    if (inOn && /^\S/.test(line)) { inOn = false; currentEvent = null; }
    if (inOn) {
      const ev = /^ {2}([A-Za-z_]+):/.exec(line);
      if (ev) { currentEvent = ev[1]; events.add(currentEvent); inPushPaths = false; continue; }
      if (currentEvent === 'push') {
        const br = /^\s+branches:\s*\[(.*)\]\s*$/.exec(line);
        if (br) {
          const list = br[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
          if (list.includes('main')) pushMain = true;
          continue;
        }
        if (/^\s+branches:/.test(line)) { inPushPaths = false; continue; }
        if (/^\s+paths:/.test(line)) { pathFilter = []; inPushPaths = true; continue; }
        if (inPushPaths) {
          const p = /^\s+-\s+['"]?([^'"]+)['"]?\s*$/.exec(line);
          if (p) { paths.push(p[1]); continue; }
          inPushPaths = false;
        }
      }
      continue;
    }
    if (/^jobs:/.test(line)) { inJobs = true; continue; }
    if (inJobs && /^\S/.test(line)) { inJobs = false; continue; }
    if (inJobs) {
      const job = /^ {2}([A-Za-z0-9_-]+):/.exec(line);
      if (job) jobs.push(job[1]);
    }
  }
  if (pathFilter !== null && paths.length > 0) pathFilter = paths;
  manualOnly = events.size === 1 && events.has('workflow_dispatch');
  return { pushMain, pathFilter, manualOnly, jobs };
}

// Enumerate every workflow's main-push effects. automaticReleaseEffect is true only
// for an unfiltered push-on-main workflow outside the security-*/idp-* control set.
export function enumerateMainPushEffects(workflowsDir) {
  const workflows = [];
  for (const file of readdirSync(workflowsDir).filter(f => f.endsWith('.yml')).sort()) {
    const text = readFileSync(join(workflowsDir, file), 'utf8');
    const parsed = parseWorkflow(text);
    const automaticReleaseEffect = parsed.pushMain && parsed.pathFilter === null && !/^(security-|idp-)/.test(file);
    workflows.push({
      file,
      pushMain: parsed.pushMain,
      pathFilter: parsed.pathFilter,
      manualOnly: parsed.manualOnly,
      automaticReleaseEffect,
      jobs: parsed.jobs.map(id => ({ id, releaseEffect: RELEASE_EFFECT_JOB_PATTERN.test(id) })),
    });
  }
  return { schemaVersion: 1, workflows };
}

// One explicitly dispatched complete required CI per bot-authored PR, bound to the
// exact H/B/T and produced by the fixed required-CI workflow digest. Stale head,
// ref-swapped, wrong workflow/ref, replayed and spoofed dispatches refuse.
export function assertPrCiDispatch({ pr, dispatch, seen }) {
  if (!isBotAuthoredPr(pr)) throw new Error('pr-not-bot-authored');
  if (dispatch.workflow !== REQUIRED_CI_WORKFLOW) throw new Error('dispatch-workflow:' + dispatch.workflow);
  if (dispatch.ref !== 'refs/heads/main') throw new Error('dispatch-ref-swapped:' + dispatch.ref);
  if (seen.has(dispatch.id)) throw new Error('dispatch-replay:' + dispatch.id);
  if (dispatch.inputs.head !== pr.head) throw new Error('dispatch-stale-head');
  if (dispatch.inputs.base !== pr.base || dispatch.inputs.tree !== pr.tree) throw new Error('dispatch-partial');
  if (typeof dispatch.inputs.plan_digest !== 'string' || !HEX64.test(dispatch.inputs.plan_digest)) throw new Error('dispatch-partial:plan_digest');
  if (typeof dispatch.producerWorkflowDigest !== 'string' || !HEX64.test(dispatch.producerWorkflowDigest)) throw new Error('dispatch-spoofed:producer-digest');
  seen.add(dispatch.id);
}

// Exact-head results satisfy the current required checks: complete, on the exact
// PR head, successful, produced by the status bridge, and with zero release effects.
export function assertExactHeadResults({ pr, results, requiredChecks, releaseJobNames = null }) {
  const isReleaseEffect = (name) => releaseJobNames ? releaseJobNames.includes(name) : RELEASE_EFFECT_JOB_PATTERN.test(name);
  for (const name of requiredChecks) {
    if (!results.some(r => r.name === name)) throw new Error('results-partial:' + name);
  }
  for (const r of results) {
    if (isReleaseEffect(r.name)) throw new Error('pr-ci-release-effect:' + r.name);
  }
  for (const r of results) {
    if (r.head_sha !== pr.head) throw new Error('results-stale:' + r.name);
  }
  for (const r of results) {
    if (r.conclusion !== 'success') throw new Error('results-failure:' + r.name);
  }
  for (const r of results) {
    if (r.actor !== 'ci-status-bridge') throw new Error('results-spoofed:' + r.name);
  }
}

// L3-G late-receipt gate: the exact packed/installed artifact must match the
// admitted receipt — same digest, same admitted range/version, exactly one
// installed copy. Stale, partial, forged and late receipts refuse.
export function lateReceiptGate({ artifact, admittedReceipt }) {
  if (!admittedReceipt.artifactDigest || !HEX64.test(admittedReceipt.artifactDigest)) throw new Error('receipt-partial:digest');
  if (artifact.installedCopies !== 1 || admittedReceipt.installedCopy !== 1) throw new Error('receipt-partial:copies');
  if (artifact.digest !== admittedReceipt.artifactDigest) throw new Error('receipt-forged');
  if (artifact.version !== admittedReceipt.range) throw new Error('receipt-stale:' + artifact.version + '!=' + admittedReceipt.range);
}

// L3-M: production credential acquisition only from protected main, through a
// trusted control workflow, by the trusted control actor. Hostile same-repo PR
// refs, unprotected refs, ordinary CI and candidate checkouts refuse.
export function assertTrustedAcquisition({ ref, workflowPath, actor, secretName }) {
  if (ref !== 'refs/heads/main') throw new Error('acquisition-hostile:ref:' + ref);
  if (!TRUSTED_ACQUISITION_WORKFLOWS.includes(workflowPath)) throw new Error('acquisition-hostile:workflow:' + workflowPath);
  if (actor !== TRUSTED_ACQUISITION_ACTOR) throw new Error('acquisition-hostile:actor:' + actor);
  if (!secretName) throw new Error('acquisition-hostile:secret');
}
