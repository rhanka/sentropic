// T6-R1 (r6 §7.3, §4.2.1) — L03b owns the exact-head PR-trigger side: a
// workflow-token PR receives full exact-H/B/T required CI with no release. The
// post-merge contract: after an eligible token merge, the ordinary push is
// suppressed, then exactly one qualified exact-M release dispatch per admitted
// effect; wrong source/ref/parents/filter/OIDC context, main move before startup,
// missing dispatch, ambiguous duplicate and push-only workflows refuse; failure
// pauses merges and retains debt.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POST_MERGE_WORKFLOW,
  assertPostMergeDispatch,
  assertPrTriggerSide,
  buildReleaseEffectsPlan,
  dispatchIntentKey,
} from './post-merge-effects.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const workflowsDir = join(repoRoot, '.github', 'workflows');

const pr = { number: 900, head: 'H'.repeat(40), base: 'B'.repeat(40), tree: 'T'.repeat(40), author: 'github-actions[bot]' };
const merge = { commit: 'M'.repeat(40), parents: [pr.base, pr.head], tree: 'T'.repeat(40) };
const requiredChecks = ['ci-gate', 'validate-llm-mesh'];
const prResults = requiredChecks.map((name, i) => ({ name, conclusion: 'success', head_sha: pr.head, check_run_id: i + 1, actor: 'ci-status-bridge' }));

describe('T6-R1 PR-trigger side: exact-head required CI, zero release effects', () => {
  it('passes a bot PR with complete exact-H/B/T results and no release job', () => {
    const plan = buildReleaseEffectsPlan({ workflowsDir, pr });
    assert.equal(plan.schemaVersion, 1);
    assert.doesNotThrow(() => assertPrTriggerSide({ pr, results: prResults, requiredChecks, plan }));
  });

  it('refuses partial/stale results or any release effect on the PR path', () => {
    const plan = buildReleaseEffectsPlan({ workflowsDir, pr });
    assert.throws(() => assertPrTriggerSide({ pr, results: prResults.slice(0, 1), requiredChecks, plan }), /results-partial/);
    assert.throws(() => assertPrTriggerSide({ pr, results: prResults.map(r => ({ ...r, head_sha: 'X'.repeat(40) })), requiredChecks, plan }), /results-stale/);
    assert.throws(() => assertPrTriggerSide({ pr, results: [...prResults, { name: 'deploy-preprod', conclusion: 'success', head_sha: pr.head, check_run_id: 99, actor: 'ci-status-bridge' }], requiredChecks, plan }), /pr-ci-release-effect/);
  });
});

describe('ReleaseEffectsPlanV1: push-only consumers block automatic merge in advance', () => {
  it('marks ci.yml release effects as requiring a qualified dispatch equivalent', () => {
    const plan = buildReleaseEffectsPlan({ workflowsDir, pr });
    const ci = plan.effects.find(e => e.workflow === 'ci.yml');
    assert.ok(ci.jobs.some(j => j.id === 'deploy-preprod' && j.releaseEffect));
    assert.equal(ci.requiresDispatchEquivalent, true);
    // IdP main-push path effects are outside the bounded repair scope: ineligible.
    const idp = plan.effects.find(e => e.workflow === 'idp-identity-sync.yml');
    assert.equal(idp.eligible, false);
    assert.equal(idp.reason, 'path-disjoint-na');
    // Manual-only workflows are never automatic effects.
    for (const wf of ['idp-session-secret.yml', 'idp-workload-secret.yml', 'security-scanner-image.yml', 'security-report-control.yml']) {
      const e = plan.effects.find(x => x.workflow === wf);
      assert.equal(e.automaticEffect, false, wf);
    }
  });

  it('a push-only effect without a tested dispatch equivalent makes the merge ineligible', () => {
    const plan = buildReleaseEffectsPlan({ workflowsDir, pr, dispatchEquivalents: {} });
    assert.equal(plan.mergeEligible, false);
    assert.ok(plan.blockers.some(b => /push-only/.test(b)));
    const withEquivalent = buildReleaseEffectsPlan({ workflowsDir, pr, dispatchEquivalents: { 'ci.yml': POST_MERGE_WORKFLOW } });
    assert.equal(withEquivalent.mergeEligible, true);
  });
});

describe('T6-R1 post-merge: one qualified exact-M dispatch per admitted effect', () => {
  const plan = buildReleaseEffectsPlan({ workflowsDir, pr, dispatchEquivalents: { 'ci.yml': POST_MERGE_WORKFLOW } });
  const goodDispatch = {
    workflow: POST_MERGE_WORKFLOW, ref: 'refs/heads/main', event: 'workflow_dispatch',
    inputs: { merge_commit: merge.commit, pr: pr.number, head: pr.head, base: pr.base, tree: pr.tree, plan_digest: plan.digest },
    runHeadSha: merge.commit, runEvent: 'workflow_dispatch', oidcSubject: `repo:rhanka/sentropic:.github/workflows/security-post-merge.yml@refs/heads/main`,
  };

  it('accepts exactly one dispatch per effect after main equals M', () => {
    const seen = new Set();
    assert.doesNotThrow(() => assertPostMergeDispatch({ merge, mainHead: merge.commit, dispatches: [goodDispatch], plan, seen }));
    assert.ok(seen.has(dispatchIntentKey({ repo: 'rhanka/sentropic', mergeCommit: merge.commit, workflow: POST_MERGE_WORKFLOW, planDigest: plan.digest })));
  });

  it('refuses wrong head/source, ref, parents, OIDC context, main move, duplicates and missing dispatch', () => {
    const seen = () => new Set();
    assert.throws(() => assertPostMergeDispatch({ merge, mainHead: merge.commit, dispatches: [{ ...goodDispatch, runHeadSha: 'X'.repeat(40) }], plan, seen: seen() }), /dispatch-wrong-head/);
    assert.throws(() => assertPostMergeDispatch({ merge, mainHead: merge.commit, dispatches: [{ ...goodDispatch, ref: 'refs/heads/other' }], plan, seen: seen() }), /dispatch-ref/);
    assert.throws(() => assertPostMergeDispatch({ merge, mainHead: merge.commit, dispatches: [{ ...goodDispatch, inputs: { ...goodDispatch.inputs, merge_commit: 'Y'.repeat(40) } }], plan, seen: seen() }), /dispatch-parents/);
    assert.throws(() => assertPostMergeDispatch({ merge, mainHead: merge.commit, dispatches: [{ ...goodDispatch, oidcSubject: 'repo:other/repo:ref' }], plan, seen: seen() }), /dispatch-oidc/);
    assert.throws(() => assertPostMergeDispatch({ merge, mainHead: 'N'.repeat(40), dispatches: [goodDispatch], plan, seen: seen() }), /main-moved/);
    const dup = new Set([dispatchIntentKey({ repo: 'rhanka/sentropic', mergeCommit: merge.commit, workflow: POST_MERGE_WORKFLOW, planDigest: plan.digest })]);
    assert.throws(() => assertPostMergeDispatch({ merge, mainHead: merge.commit, dispatches: [goodDispatch], plan, seen: dup }), /duplicate-dispatch/);
    assert.throws(() => assertPostMergeDispatch({ merge, mainHead: merge.commit, dispatches: [], plan, seen: seen() }), /dispatch-missing/);
  });

  it('a failed effect pauses further merges and retains debt', () => {
    const outcome = assertPostMergeDispatch({ merge, mainHead: merge.commit, dispatches: [{ ...goodDispatch, outcome: 'failure' }], plan, seen: new Set() });
    assert.equal(outcome.pauseMerges, true);
    assert.ok(outcome.debtRetained.includes('ci.yml'));
  });
});
