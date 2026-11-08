// Tested-tree qualification (BR92-EX1). A push to main may reuse the verdict of
// the newest completed pull_request run of the same workflow, from the same
// repository, whose head commit carries the identical tree. Pure assessment
// over evidence captured read-only by the `changes` job: anything missing,
// foreign, failed, unverifiable or not covered keeps the complete run.
// Runs only behind root Make targets.
export const TREE = /^[0-9a-f]{40}$/;
export const WORKFLOW_PATH = '.github/workflows/ci.yml';
export const RUN_ID = /^[1-9][0-9]*$/;

const keep = reason => ({ mode: 'in-run', reason });
const sameRepository = (run, repository) => run?.head_repository === repository && run?.repository === repository;

// Newest same-repository pull_request run of this workflow carrying the tree.
export function selectTestedRun(evidence) {
  const eligible = (evidence?.candidates ?? []).filter(run => run.event === 'pull_request'
    && run.tree_id === evidence.tree && String(run.workflow_id) === String(evidence.workflowId)
    && sameRepository(run, evidence.repository) && RUN_ID.test(String(run.id)));
  return eligible.reduce((newest, run) => !newest || Number(run.id) > Number(newest.id) ? run : newest, null);
}

// fullExpected/shortExpected: workflowExpected rows with tested_tree pinned to
// 'false' and 'true'. Every row the shortcut drops must have executed and
// succeeded in the referenced run; the shortcut may never add a row.
export function assessTestedTree({ evidence = null, context = {}, policyDigest = null,
  fullExpected = [], shortExpected = null } = {}) {
  if (context.event !== 'push' || context.ref !== 'refs/heads/main') return keep('not-a-main-push');
  if (!evidence) return keep('no-evidence');
  if (evidence.error) return keep(`capture-error: ${evidence.error}`);
  if (!TREE.test(String(evidence.tree ?? ''))) return keep('invalid-tree');
  if (!evidence.sha || evidence.sha !== context.identity?.headSha) return keep('source-mismatch');
  if (!evidence.repository || !evidence.workflowId) return keep('missing-identity');
  const chosen = selectTestedRun(evidence);
  if (!chosen) {
    return keep((evidence.candidates ?? []).some(run => run.tree_id === evidence.tree)
      ? 'no-same-repository-run' : 'no-tested-run');
  }
  const run = evidence.run;
  if (!run || String(run.id) !== String(chosen.id)) return keep('evidence-not-newest-run');
  if (String(run.id) === String(context.identity?.runId)) return keep('self-reference');
  if (run.event !== 'pull_request') return keep(`not-a-pull-request-run: ${run.event}`);
  if (!sameRepository(run, evidence.repository)) return keep('foreign-repository');
  if (String(run.workflow_id) !== String(evidence.workflowId) || run.path !== WORKFLOW_PATH) return keep('foreign-workflow');
  if (run.tree_id !== evidence.tree) return keep('tree-mismatch');
  if (run.status !== 'completed' || run.conclusion !== 'success') return keep(`run-${run.status}-${run.conclusion}`);
  const jobs = evidence.jobs ?? [];
  if (jobs.length === 0) return keep('missing-jobs');
  if (jobs.some(job => String(job.run_id) !== String(run.id) || String(job.run_attempt) !== String(run.run_attempt))) {
    return keep('job-identity-mismatch');
  }
  const byName = new Map(jobs.map(job => [job.name, job]));
  if (byName.get('ci-gate')?.conclusion !== 'success') return keep('ci-gate-not-success');
  const manifest = evidence.expected;
  if (!Array.isArray(manifest?.expected) || manifest.expected.length === 0) return keep('missing-expected-set');
  if (String(manifest.identity?.runId) !== String(run.id) || manifest.identity?.headSha !== run.head_sha) {
    return keep('expected-set-identity-mismatch');
  }
  if (!policyDigest || manifest.policyDigest !== policyDigest) return keep('policy-digest-mismatch');
  const failed = manifest.expected.find(row => row.required !== false && row.selected !== false
    && byName.get(row.job)?.conclusion !== 'success');
  if (failed) return keep(`expected-result-not-success: ${failed.job}`);
  if (!Array.isArray(shortExpected)) return keep('missing-selection');
  const full = new Map(fullExpected.map(row => [row.job, row]));
  const short = new Map(shortExpected.map(row => [row.job, row]));
  const added = shortExpected.find(row => row.selected && !full.get(row.job)?.selected);
  if (added || full.size !== short.size) return keep(`shortcut-changes-membership: ${added?.job ?? 'size'}`);
  const satisfied = fullExpected.filter(row => row.selected && !short.get(row.job).selected);
  if (satisfied.length === 0) return keep('nothing-satisfied');
  const gap = satisfied.find(row => byName.get(row.job)?.conclusion !== 'success');
  if (gap) return keep(`coverage-gap: ${gap.job}`);
  return { mode: 'tested-tree', runId: Number(run.id), attempt: Number(run.run_attempt), url: run.html_url ?? null,
    headSha: run.head_sha, headBranch: run.head_branch ?? null, tree: evidence.tree, policyDigest,
    satisfied: satisfied.map(row => ({ job: row.job, jobId: byName.get(row.job).id ?? null,
      url: byName.get(row.job).html_url ?? null })) };
}

// Shared by the gate, the release receipt and the capacity receipt: a recorded
// qualification is either in-run, or a tested-tree reference to another
// identified run of the same tree. Returns the problems (empty when valid).
export function qualificationProblems(qualification, { runId = null, tree = null } = {}) {
  const mode = qualification?.mode ?? 'in-run';
  if (mode === 'in-run') return [];
  if (mode !== 'tested-tree') return [`unknown qualification mode: ${mode}`];
  const problems = [];
  if (!RUN_ID.test(String(qualification.runId ?? ''))) problems.push(`tested-tree qualification without a run id: ${qualification.runId}`);
  else if (runId !== null && String(qualification.runId) === String(runId)) problems.push('tested-tree qualification references its own run');
  if (!TREE.test(String(qualification.tree ?? ''))) problems.push(`tested-tree qualification without a tree: ${qualification.tree}`);
  else if (tree !== null && qualification.tree !== tree) problems.push(`tested-tree qualification for another tree: ${qualification.tree} (expected ${tree})`);
  return problems;
}
