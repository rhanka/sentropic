// T6-R1 (r6 §7.3, §4.2.1) — L03b owns the exact-head PR-trigger side: a
// workflow-token PR receives full exact-H/B/T required CI with no release. The
// post-merge contract: after an eligible token merge, the ordinary push is
// suppressed, then exactly one qualified exact-M release dispatch per admitted
// effect; wrong source/ref/parents/filter/OIDC context, main move before startup,
// missing dispatch, ambiguous duplicate and push-only workflows refuse; a failed
// effect pauses merges and retains debt.
import { createHash } from 'node:crypto';
import {
  POST_MERGE_WORKFLOW,
  assertExactHeadResults,
  enumerateMainPushEffects,
} from './ci-trigger-bridge.mjs';

export { POST_MERGE_WORKFLOW };

const HEX40 = /^[0-9A-Za-z]{40}$/;
const HEX64 = /^[0-9a-z]{64}$/;
const REPO = 'rhanka/sentropic';
const OIDC_SUBJECT = `repo:${REPO}:.github/workflows/security-post-merge.yml@refs/heads/main`;

// ReleaseEffectsPlanV1: the exact main-push effect inventory seeded from the real
// workflow directory. Push-only release effects require a qualified dispatch
// equivalent (the fixed post-merge workflow) before any merge is eligible.
export function buildReleaseEffectsPlan({ workflowsDir, pr, dispatchEquivalents = {} }) {
  const inventory = enumerateMainPushEffects(workflowsDir);
  const effects = [];
  const blockers = [];
  for (const w of inventory.workflows) {
    const releaseJobs = w.jobs.filter(j => j.releaseEffect);
    const automaticEffect = w.automaticReleaseEffect && releaseJobs.length > 0;
    let eligible = false;
    let reason = 'manual-only';
    if (w.pathFilter !== null) {
      reason = 'path-disjoint-na';
    } else if (automaticEffect) {
      if (dispatchEquivalents[w.file] === POST_MERGE_WORKFLOW) {
        eligible = true;
        reason = 'dispatch-equivalent-qualified';
      } else {
        reason = 'push-only-no-dispatch-equivalent';
        blockers.push(`push-only:${w.file}`);
      }
    }
    effects.push({
      workflow: w.file,
      jobs: w.jobs,
      automaticEffect,
      requiresDispatchEquivalent: automaticEffect,
      eligible,
      reason,
    });
  }
  const mergeEligible = blockers.length === 0 && effects.some(e => e.automaticEffect);
  const digest = createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, pr: { number: pr.number, head: pr.head, base: pr.base, tree: pr.tree }, effects: effects.map(e => ({ workflow: e.workflow, automaticEffect: e.automaticEffect, eligible: e.eligible, reason: e.reason, jobs: e.jobs })) }))
    .digest('hex');
  return { schemaVersion: 1, digest, effects, mergeEligible, blockers };
}

export function dispatchIntentKey({ repo, mergeCommit, workflow, planDigest }) {
  return createHash('sha256').update(`${repo}@${mergeCommit}:${workflow}:${planDigest}`).digest('hex');
}

// PR-trigger side: complete exact-H/B/T required results and zero release effects.
export function assertPrTriggerSide({ pr, results, requiredChecks, plan }) {
  const releaseJobNames = plan.effects.flatMap(e => e.jobs.filter(j => j.releaseEffect).map(j => j.id));
  assertExactHeadResults({ pr, results, requiredChecks, releaseJobNames });
}

// Post-merge side: after an eligible token merge, main must still equal the merge
// commit, and each admitted automatic effect must have exactly one qualified
// workflow_dispatch run of the post-merge workflow bound to the exact M and the
// plan digest, with the fixed OIDC subject. Wrong head/ref/parents/OIDC context,
// main move, missing dispatch and ambiguous duplicates refuse; a failed effect
// pauses further merges and retains debt.
export function assertPostMergeDispatch({ merge, mainHead, dispatches, plan, seen }) {
  if (mainHead !== merge.commit) throw new Error('main-moved:' + mainHead);
  if (!Array.isArray(merge.parents) || merge.parents.length !== 2) throw new Error('merge-parents');
  const admitted = plan.effects.filter(e => e.automaticEffect);
  if (admitted.length === 0) throw new Error('dispatch-missing:no-admitted-effects');
  if (dispatches.length === 0) throw new Error('dispatch-missing');
  for (const d of dispatches) {
    if (d.workflow !== POST_MERGE_WORKFLOW || d.event !== 'workflow_dispatch' || d.runEvent !== 'workflow_dispatch') throw new Error('dispatch-source:' + d.workflow);
    if (d.ref !== 'refs/heads/main') throw new Error('dispatch-ref:' + d.ref);
    if (d.runHeadSha !== merge.commit) throw new Error('dispatch-wrong-head:' + d.runHeadSha);
    if (d.inputs.merge_commit !== merge.commit) throw new Error('dispatch-parents:' + d.inputs.merge_commit);
    if (!HEX40.test(d.inputs.merge_commit) || !HEX64.test(d.inputs.plan_digest)) throw new Error('dispatch-partial');
    if (d.inputs.plan_digest !== plan.digest) throw new Error('dispatch-plan-mismatch');
    if (d.oidcSubject !== OIDC_SUBJECT) throw new Error('dispatch-oidc:' + d.oidcSubject);
    const key = dispatchIntentKey({ repo: REPO, mergeCommit: merge.commit, workflow: d.workflow, planDigest: d.inputs.plan_digest });
    if (seen.has(key)) throw new Error('duplicate-dispatch:' + key);
    seen.add(key);
  }
  for (const e of admitted) {
    const covered = dispatches.some(d => d.inputs.plan_digest === plan.digest && d.workflow === POST_MERGE_WORKFLOW);
    if (!covered) throw new Error('dispatch-missing:' + e.workflow);
  }
  const failed = dispatches.find(d => d.outcome === 'failure');
  if (failed) {
    return { pauseMerges: true, debtRetained: admitted.map(e => e.workflow) };
  }
  return { pauseMerges: false, debtRetained: [] };
}
