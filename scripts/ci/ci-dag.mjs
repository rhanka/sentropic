// BR-79: artifact readiness and release barriers are separate contracts.
import { workflowExpected } from './ci-expected-results.mjs';

export const runtimeInputs = {
  'test-e2e': ['changes', 'build-api-image', 'build-ui', 'build-e2e'],
  'e2e-vscode': ['changes', 'build-api-image', 'build-ui', 'build-e2e'],
  'smoke-idp-screens': ['changes', 'build-api-image', 'build-api-tool-image', 'build-e2e'],
  'test-smoke-restore': ['changes', 'build-api-image', 'build-api-tool-image'],
};
export const scanInputs = { api: 'build-api-image', 'api-tool': 'build-api-tool-image',
  ui: 'build-ui', e2e: 'build-e2e' };
const needsOf = job => [job?.needs ?? []].flat();

export function checkDag(workflow, context) {
  const errors = [];
  const jobs = workflow.jobs;
  for (const [name, inputs] of Object.entries(runtimeInputs)) {
    if (JSON.stringify(needsOf(jobs[name]).sort()) !== JSON.stringify([...inputs].sort())) {
      errors.push(`${name}: runtime inputs differ`);
    }
  }
  for (const [kind, producer] of Object.entries(scanInputs)) {
    if (JSON.stringify(needsOf(jobs[`security-container-${kind}`]).sort())
      !== JSON.stringify(['changes', producer].sort())) errors.push(`${kind}: scan inputs differ`);
  }
  const expected = workflowExpected(workflow, context);
  const gate = new Set(needsOf(jobs['ci-gate']));
  for (const row of expected.filter(row => row.required && row.selected)) {
    const name = row.job.split(' (')[0];
    if (!name.startsWith('publish-') && !['deploy-preprod', 'bootstrap-publish'].includes(name)
      && !gate.has(name)) errors.push(`${name}: missing final join`);
  }
  const ancestors = name => {
    const found = new Set();
    const visit = (current, active = new Set()) => {
      if (!jobs[current] || active.has(current)) throw Error(`Invalid DAG: ${current}`);
      for (const parent of needsOf(jobs[current])) {
        if (!found.has(parent)) { visit(parent, new Set([...active, current])); found.add(parent); }
      }
    };
    visit(name);
    return found;
  };
  for (const publisher of ['publish-api-image', 'publish-ui-image']) {
    const parents = ancestors(publisher);
    for (const name of ['typecheck-lint-ui', 'typecheck-lint-api', 'security-sast-sca', 'security-container']) {
      if (!parents.has(name)) errors.push(`${publisher}: missing release barrier ${name}`);
    }
  }
  return { ok: errors.length === 0, errors, expected };
}

// Readiness uses completed producer jobs, including artifact upload. Missing
// spans stay null; queue/admission time never becomes an execution duration.
export function readiness(jobs, dependencies = runtimeInputs) {
  return Object.entries(dependencies).map(([name, inputs]) => {
    const consumers = jobs.filter(job => job.name === name || job.name.startsWith(`${name} (`));
    const parents = inputs.map(input => jobs.find(job => job.name === input));
    const ready = parents.every(job => job?.conclusion === 'success' && job.completed_at)
      ? Math.max(...parents.map(job => Date.parse(job.completed_at))) : null;
    return { name, readyAt: ready === null ? null : new Date(ready).toISOString(),
      executions: consumers.map(job => ({ jobId: job.id, name: job.name, conclusion: job.conclusion,
        startedAt: job.started_at ?? null, completedAt: job.completed_at ?? null,
        admissionSeconds: ready !== null && job.runner_id && job.started_at
          ? (Date.parse(job.started_at) - ready) / 1000 : null })) };
  });
}
