// T5-C5 / L3-G / L3-M (r6 §7.3, §4.2.1, §6.3): the bot-PR trigger/check bridge.
// A workflow-token-authored PR receives exactly one explicitly dispatched complete
// required CI on exact H/B/T through the fixed security-required-ci.yml entry with
// zero release effects; stale/ref-swapped/partial/missing/replayed/spoofed results
// fail. The late-receipt gate binds the exact packed/installed artifact. Hostile
// same-repo PR / unprotected-ref production-credential acquisition refuses (A13
// stays source-gap).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  A13_STATUS,
  POST_MERGE_WORKFLOW,
  REQUIRED_CI_WORKFLOW,
  RELEASE_EFFECT_JOB_PATTERN,
  TRUSTED_ACQUISITION_WORKFLOWS,
  assertExactHeadResults,
  assertPrCiDispatch,
  assertTrustedAcquisition,
  enumerateMainPushEffects,
  isBotAuthoredPr,
  lateReceiptGate,
} from './ci-trigger-bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const workflowsDir = join(repoRoot, '.github', 'workflows');

const pr = { number: 900, author: 'github-actions[bot]', authorType: 'Bot', head: 'H'.repeat(40), base: 'B'.repeat(40), tree: 'T'.repeat(40) };
const requiredChecks = ['ci-gate', 'validate-llm-mesh', 'validate-ci-capacity-metrics'];
const goodResults = requiredChecks.map((name, i) => ({
  name, conclusion: 'success', head_sha: pr.head, check_run_id: 1000 + i, actor: 'ci-status-bridge',
}));

describe('T5-C5: actual main-push effect enumeration (ReleaseEffectsPlanV1 seed)', () => {
  it('enumerates every workflow and classifies its main-push effects', () => {
    const plan = enumerateMainPushEffects(workflowsDir);
    const byFile = new Map(plan.workflows.map(w => [w.file, w]));
    assert.ok(byFile.has('ci.yml'));
    assert.equal(byFile.get('ci.yml').pushMain, true);
    assert.equal(byFile.get('ci.yml').pathFilter, null);
    assert.equal(byFile.get('idp-identity-sync.yml').pushMain, true);
    assert.ok(byFile.get('idp-identity-sync.yml').pathFilter.includes('deploy/k8s/overlays/prod/idp-identity-sync/**'));
    for (const manual of ['idp-session-secret.yml', 'idp-workload-secret.yml', 'security-scanner-image.yml']) {
      assert.equal(byFile.get(manual).pushMain, false, `${manual} must not push on main`);
      assert.equal(byFile.get(manual).manualOnly, true);
    }
    assert.equal(byFile.get('live-speech.yml').pushMain, false);
    assert.equal(byFile.get('security-report-control.yml').pushMain, false);
  });

  it('ci.yml carries exactly the r6 §4.2.1 release-effect job set', () => {
    const plan = enumerateMainPushEffects(workflowsDir);
    const ci = plan.workflows.find(w => w.file === 'ci.yml');
    const releaseJobs = ci.jobs.filter(j => j.releaseEffect).map(j => j.id).sort();
    for (const expected of ['publish-api-image', 'publish-ui-image', 'deploy-preprod', 'verify-train-lock-integrity',
      'publish-llm-mesh', 'publish-llm-gateway', 'publish-chat-ui', 'publish-cited-source-viewer',
      'publish-cowork-bridge', 'publish-oauth-verify', 'publish-mcp-auth', 'publish-mcp-platform',
      'publish-artifacts', 'publish-auth-hono', 'publish-auth-client', 'publish-auth-ui',
      'publish-cowork-desktop', 'publish-contracts', 'publish-events', 'publish-chat-core',
      'publish-chat-server', 'publish-comments', 'publish-flow', 'publish-harness', 'publish-cluster-mesh']) {
      assert.ok(releaseJobs.includes(expected), `missing release-effect job ${expected}`);
    }
    for (const job of ci.jobs) {
      assert.equal(job.releaseEffect, RELEASE_EFFECT_JOB_PATTERN.test(job.id), `misclassified ${job.id}`);
    }
  });

  it('no security-* or IdP workflow is an automatic post-merge effect', () => {
    const plan = enumerateMainPushEffects(workflowsDir);
    for (const w of plan.workflows) {
      if (w.file.startsWith('security-') || w.file.startsWith('idp-')) {
        assert.equal(w.automaticReleaseEffect, false, `${w.file} must never be auto-dispatched`);
      }
    }
  });
});

describe('T5-C5: one dispatched exact-H/B/T required CI per bot-authored PR', () => {
  it('accepts the single fixed dispatch on protected main bound to H/B/T', () => {
    assert.ok(isBotAuthoredPr(pr));
    const seen = new Set();
    assert.doesNotThrow(() => assertPrCiDispatch({ pr, dispatch: {
      workflow: REQUIRED_CI_WORKFLOW, ref: 'refs/heads/main', id: 'd-1',
      inputs: { head: pr.head, base: pr.base, tree: pr.tree, plan_digest: 'p'.repeat(64) },
      producerWorkflowDigest: 'w'.repeat(64),
    }, seen }));
    assert.ok(seen.has('d-1'));
  });

  it('refuses stale head, ref-swapped, wrong workflow, wrong ref, replayed and spoofed dispatches', () => {
    const base = { workflow: REQUIRED_CI_WORKFLOW, ref: 'refs/heads/main', id: 'd-1',
      inputs: { head: pr.head, base: pr.base, tree: pr.tree, plan_digest: 'p'.repeat(64) },
      producerWorkflowDigest: 'w'.repeat(64) };
    assert.throws(() => assertPrCiDispatch({ pr, dispatch: { ...base, inputs: { ...base.inputs, head: 'X'.repeat(40) } }, seen: new Set() }), /dispatch-stale-head/);
    assert.throws(() => assertPrCiDispatch({ pr, dispatch: { ...base, ref: 'refs/heads/feat/x' }, seen: new Set() }), /dispatch-ref-swapped/);
    assert.throws(() => assertPrCiDispatch({ pr, dispatch: { ...base, workflow: POST_MERGE_WORKFLOW }, seen: new Set() }), /dispatch-workflow/);
    assert.throws(() => assertPrCiDispatch({ pr, dispatch: { ...base, ref: 'refs/pull/900/head' }, seen: new Set() }), /dispatch-ref-swapped/);
    const seen = new Set(['d-1']);
    assert.throws(() => assertPrCiDispatch({ pr, dispatch: base, seen }), /dispatch-replay/);
    assert.throws(() => assertPrCiDispatch({ pr, dispatch: { ...base, id: 'd-2', producerWorkflowDigest: 'X'.repeat(64) }, seen: new Set() }), /dispatch-spoofed/);
    assert.throws(() => assertPrCiDispatch({ pr, dispatch: { ...base, id: 'd-3', inputs: { ...base.inputs, plan_digest: '' } }, seen: new Set() }), /dispatch-partial/);
  });

  it('human-authored PRs do not take the bot bridge', () => {
    assert.equal(isBotAuthoredPr({ ...pr, author: 'rhanka', authorType: 'User' }), false);
    assert.throws(() => assertPrCiDispatch({ pr: { ...pr, author: 'rhanka', authorType: 'User' }, dispatch: { workflow: REQUIRED_CI_WORKFLOW, ref: 'refs/heads/main', id: 'd-9', inputs: { head: pr.head, base: pr.base, tree: pr.tree, plan_digest: 'p'.repeat(64) }, producerWorkflowDigest: 'w'.repeat(64) }, seen: new Set() }), /pr-not-bot-authored/);
  });
});

describe('T5-C5: exact-head results satisfy current required checks with zero release effects', () => {
  it('accepts complete success results on the exact head', () => {
    assert.doesNotThrow(() => assertExactHeadResults({ pr, results: goodResults, requiredChecks }));
  });

  it('refuses stale, partial, failing, replayed and spoofed results', () => {
    assert.throws(() => assertExactHeadResults({ pr, results: goodResults.map(r => ({ ...r, head_sha: 'X'.repeat(40) })), requiredChecks }), /results-stale/);
    assert.throws(() => assertExactHeadResults({ pr, results: goodResults.slice(0, 2), requiredChecks }), /results-partial/);
    assert.throws(() => assertExactHeadResults({ pr, results: goodResults.map(r => ({ ...r, conclusion: 'failure' })), requiredChecks }), /results-failure/);
    assert.throws(() => assertExactHeadResults({ pr, results: goodResults.map(r => ({ ...r, actor: 'some-user' })), requiredChecks }), /results-spoofed/);
    assert.throws(() => assertExactHeadResults({ pr, results: [...goodResults, { name: 'publish-llm-mesh', conclusion: 'success', head_sha: pr.head, check_run_id: 2000, actor: 'ci-status-bridge' }], requiredChecks }), /pr-ci-release-effect/);
  });
});

describe('L3-G: full late-receipt gate on the exact packed/installed artifact', () => {
  const receipt = { kind: 'packed-tgz', artifactDigest: 'a'.repeat(64), installedCopy: 1, range: '0.32.3' };
  it('accepts the exact artifact bound to the admitted receipt', () => {
    assert.doesNotThrow(() => lateReceiptGate({ artifact: { kind: 'packed-tgz', digest: 'a'.repeat(64), installedCopies: 1, version: '0.32.3' }, admittedReceipt: receipt }));
  });
  it('refuses stale, partial, forged and late receipts', () => {
    assert.throws(() => lateReceiptGate({ artifact: { kind: 'packed-tgz', digest: 'b'.repeat(64), installedCopies: 1, version: '0.32.3' }, admittedReceipt: receipt }), /receipt-forged/);
    assert.throws(() => lateReceiptGate({ artifact: { kind: 'packed-tgz', digest: 'a'.repeat(64), installedCopies: 1, version: '0.32.2' }, admittedReceipt: receipt }), /receipt-stale/);
    assert.throws(() => lateReceiptGate({ artifact: { kind: 'packed-tgz', digest: 'a'.repeat(64), installedCopies: 2, version: '0.32.3' }, admittedReceipt: receipt }), /receipt-partial/);
    assert.throws(() => lateReceiptGate({ artifact: { kind: 'packed-tgz', digest: 'a'.repeat(64), installedCopies: 1, version: '0.32.3' }, admittedReceipt: { ...receipt, artifactDigest: '' } }), /receipt-partial/);
  });
});

describe('L3-M: production credential acquisition is protected-trusted-control only (A13 source-gap)', () => {
  it('accepts only protected main through a trusted workflow and actor', () => {
    assert.equal(A13_STATUS, 'source-gap');
    for (const wf of TRUSTED_ACQUISITION_WORKFLOWS) {
      assert.doesNotThrow(() => assertTrustedAcquisition({ ref: 'refs/heads/main', workflowPath: wf, actor: 'trusted-control', secretName: 'N9_PRODUCTION_BACKUP' }));
    }
  });
  it('refuses hostile same-repo PR, unprotected ref and candidate checkout', () => {
    for (const wf of TRUSTED_ACQUISITION_WORKFLOWS) {
      assert.throws(() => assertTrustedAcquisition({ ref: 'refs/pull/900/head', workflowPath: wf, actor: 'trusted-control', secretName: 'N9' }), /acquisition-hostile/);
      assert.throws(() => assertTrustedAcquisition({ ref: 'refs/heads/feat/x', workflowPath: wf, actor: 'trusted-control', secretName: 'N9' }), /acquisition-hostile/);
      assert.throws(() => assertTrustedAcquisition({ ref: 'refs/heads/main', workflowPath: '.github/workflows/ci.yml', actor: 'trusted-control', secretName: 'N9' }), /acquisition-hostile/);
      assert.throws(() => assertTrustedAcquisition({ ref: 'refs/heads/main', workflowPath: wf, actor: 'candidate-checkout', secretName: 'N9' }), /acquisition-hostile/);
    }
  });
});
