// Tested-tree qualification (BR92-EX1). A push to main may reuse the verdict of
// a completed pull_request run of the same workflow, from the same repository,
// whose head commit carries the identical tree. Pure assessment over evidence
// captured read-only by the `changes` job: anything missing, foreign, failed,
// ambiguous, stale, unverifiable or not covered keeps the complete run.
// Residual: a dropped member is proven by its job conclusion only; a job that
// concludes success with every step skipped cannot be told apart here.
// Runs only behind root Make targets.
export const TREE = /^[0-9a-f]{40}$/;
export const WORKFLOW_PATH = '.github/workflows/ci.yml';
export const RUN_ID = /^[1-9][0-9]*$/;
// Bound on the reused attempt's start, in hours, when the capture sets none.
export const DEFAULT_MAX_AGE_HOURS = 24;

const keep = reason => ({ mode: 'in-run', reason });
const sameRepository = (run, repository) => run?.head_repository === repository && run?.repository === repository;
const green = row => row?.status === 'completed' && row?.conclusion === 'success';

// Every attempt of a candidate is its own conclusion: attempts 1..run_attempt
// must all be captured, the last one is the run's state, and all must be green.
function attemptProblem(run) {
  const count = Number(run.run_attempt);
  const attempts = run.attempts;
  if (!Number.isInteger(count) || count < 1 || !Array.isArray(attempts) || attempts.length !== count
    || attempts.some((row, index) => Number(row?.attempt) !== index + 1)) return `candidate-attempts-incomplete: ${run.id}`;
  const last = attempts[count - 1];
  if (last.status !== run.status || last.conclusion !== run.conclusion) return `candidate-attempt-mismatch: ${run.id}`;
  const red = attempts.find(row => !green(row));
  return red ? `candidate-not-green: ${run.id}#${red.attempt} ${red.status}-${red.conclusion}` : null;
}

// No newest-wins: every same-tree pull_request candidate of this workflow, of any
// repository, must be green on every attempt. Only then is the newest
// same-repository run reused, through the attempt that concluded it.
export function selectTestedRun(evidence) {
  const sameTree = (evidence?.candidates ?? []).filter(run => run.event === 'pull_request'
    && run.tree_id === evidence.tree && String(run.workflow_id) === String(evidence.workflowId));
  if (sameTree.length === 0) return { problem: 'no-tested-run' };
  for (const run of sameTree) {
    if (!RUN_ID.test(String(run.id))) return { problem: `candidate-invalid-id: ${run.id}` };
    const problem = attemptProblem(run);
    if (problem) return { problem };
  }
  const eligible = sameTree.filter(run => sameRepository(run, evidence.repository));
  if (eligible.length === 0) return { problem: 'no-same-repository-run' };
  const chosen = eligible.reduce((newest, run) => Number(run.id) > Number(newest.id) ? run : newest);
  return { chosen, candidates: new Set(sameTree.map(run => String(run.id))).size };
}

// fullExpected/shortExpected: workflowExpected rows with tested_tree pinned to
// 'false' and 'true'. Every row the shortcut drops must have executed and
// succeeded in the referenced attempt; the shortcut may never add a row.
export function assessTestedTree({ evidence = null, context = {}, policyDigest = null,
  fullExpected = [], shortExpected = null } = {}) {
  if (context.event !== 'push' || context.ref !== 'refs/heads/main') return keep('not-a-main-push');
  if (!evidence) return keep('no-evidence');
  if (evidence.error) return keep(`capture-error: ${evidence.error}`);
  if (!TREE.test(String(evidence.tree ?? ''))) return keep('invalid-tree');
  if (!evidence.sha || evidence.sha !== context.identity?.headSha) return keep('source-mismatch');
  if (context.identity?.tree !== evidence.tree) return keep('source-tree-mismatch');
  if (!evidence.repository || !evidence.workflowId) return keep('missing-identity');
  const maxAgeHours = evidence.maxAgeHours === undefined ? DEFAULT_MAX_AGE_HOURS : evidence.maxAgeHours;
  if (typeof maxAgeHours !== 'number' || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return keep('invalid-age-bound');
  const { chosen, candidates, problem } = selectTestedRun(evidence);
  if (problem) return keep(problem);
  const run = evidence.run;
  if (!run || String(run.id) !== String(chosen.id)) return keep('evidence-not-selected-run');
  if (String(run.run_attempt) !== String(chosen.run_attempt)) return keep('evidence-not-concluded-attempt');
  if (String(run.id) === String(context.identity?.runId)) return keep('self-reference');
  if (run.event !== 'pull_request') return keep(`not-a-pull-request-run: ${run.event}`);
  if (!sameRepository(run, evidence.repository)) return keep('foreign-repository');
  if (String(run.workflow_id) !== String(evidence.workflowId) || run.path !== WORKFLOW_PATH) return keep('foreign-workflow');
  if (run.tree_id !== evidence.tree) return keep('tree-mismatch');
  if (!green(run)) return keep(`run-${run.status}-${run.conclusion}`);
  const started = Date.parse(run.run_started_at ?? '');
  const captured = Date.parse(evidence.capturedAt ?? '');
  if (!Number.isFinite(started) || !Number.isFinite(captured)) return keep('missing-run-time');
  const ageHours = (captured - started) / 3_600_000;
  if (ageHours < 0) return keep('run-started-after-capture');
  if (ageHours > maxAgeHours) return keep(`run-too-old: ${ageHours.toFixed(1)}h > ${maxAgeHours}h`);
  const jobs = evidence.jobs ?? [];
  if (jobs.length === 0) return keep('missing-jobs');
  if (jobs.some(job => String(job.run_id) !== String(run.id) || String(job.run_attempt) !== String(run.run_attempt))) {
    return keep('job-identity-mismatch');
  }
  const byName = new Map(jobs.map(job => [job.name, job]));
  if (byName.get('ci-gate')?.conclusion !== 'success') return keep('ci-gate-not-success');
  const manifest = evidence.expected;
  if (!Array.isArray(manifest?.expected) || manifest.expected.length === 0) return keep('missing-expected-set');
  if (String(manifest.identity?.runId) !== String(run.id) || String(manifest.identity?.attempt) !== String(run.run_attempt)
    || manifest.identity?.headSha !== run.head_sha) return keep('expected-set-identity-mismatch');
  // The run's own checkout (the PR merge ref) must be this tree, whatever its base.
  if (manifest.identity?.tree !== evidence.tree) return keep('tested-tree-mismatch');
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
  return { mode: 'tested-tree', mergeSha: evidence.sha, runId: Number(run.id), attempt: Number(run.run_attempt),
    url: run.html_url ?? null, headSha: run.head_sha, headBranch: run.head_branch ?? null, tree: evidence.tree,
    startedAt: run.run_started_at, ageHours: Number(ageHours.toFixed(2)), maxAgeHours, candidates, policyDigest,
    satisfied: satisfied.map(row => ({ job: row.job, jobId: byName.get(row.job).id ?? null,
      url: byName.get(row.job).html_url ?? null })) };
}

// Shared by the gate, the release receipt and the capacity receipt: a recorded
// qualification is either in-run, or a tested-tree reference to another
// identified run attempt of the same tree, for this merge commit when known.
// Returns the problems (empty when valid).
export function qualificationProblems(qualification, { runId = null, tree = null, sha = null } = {}) {
  const mode = qualification?.mode ?? 'in-run';
  if (mode === 'in-run') return [];
  if (mode !== 'tested-tree') return [`unknown qualification mode: ${mode}`];
  const problems = [];
  if (!RUN_ID.test(String(qualification.runId ?? ''))) problems.push(`tested-tree qualification without a run id: ${qualification.runId}`);
  else if (runId !== null && String(qualification.runId) === String(runId)) problems.push('tested-tree qualification references its own run');
  if (!RUN_ID.test(String(qualification.attempt ?? ''))) problems.push(`tested-tree qualification without an attempt: ${qualification.attempt}`);
  if (!TREE.test(String(qualification.tree ?? ''))) problems.push(`tested-tree qualification without a tree: ${qualification.tree}`);
  else if (tree !== null && qualification.tree !== tree) problems.push(`tested-tree qualification for another tree: ${qualification.tree} (expected ${tree})`);
  if (!TREE.test(String(qualification.mergeSha ?? ''))) problems.push(`tested-tree qualification without a merge sha: ${qualification.mergeSha}`);
  else if (sha !== null && qualification.mergeSha !== sha) problems.push(`tested-tree qualification for another merge: ${qualification.mergeSha} (expected ${sha})`);
  return problems;
}
