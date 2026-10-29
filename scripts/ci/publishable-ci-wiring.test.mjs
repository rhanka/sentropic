// Workflow and Makefile wiring assertions for the publishable manifest guard (make test-publishable-manifests).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BOOTSTRAP_TARGETS, PACK_TARGETS, STEADY_STATE_PUBLISHERS, dependencyFloor, publishFilter, waitForVersion } from './publishable-manifests.mjs';
import { evaluateSelection } from './ci-expected-results.mjs';
// Register the S1 contracts in the existing required, credential-free Node validation lane.
import '../security/daily/schema.test.mjs';
import '../security/daily/inventory.test.mjs';
import '../security/daily/scan.test.mjs';
import '../security/daily/toolchain-contract.test.mjs';
import '../security/daily/trivy.test.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
const jobs = ci.jobs;
const CTX = {
  CI_MANIFEST_CONTEXT: '${{ toJSON(needs.changes.outputs) }}',
  CI_MANIFEST_EVENT: '${{ github.event_name }}',
  CI_MANIFEST_BOOTSTRAP_TARGET: "${{ inputs.bootstrap_publish_target || 'none' }}",
};
// Baseline lint evidence on base 28bfcf9f5 (BUILD Lot G-B0): wire a package lint only when it passed.
const LINT_BASELINE = { 'cluster-mesh': 'pass', 'llm-mesh': 'pass', 'llm-gateway': 'pass' };
const recipe = (target) => {
  const m = makefile.match(new RegExp(`^${target}:[^\\n]*\\n((?:\\t[^\\n]*\\n?)+)`, 'm'));
  return m ? m[1] : null;
};
const needsOf = (job) => [jobs[job].needs ?? []].flat();

const assertActionsPermissions = (workflow) => {
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name === 'delete-transport-artifacts') {
      assert.deepEqual(job.permissions, { actions: 'write' });
    } else {
      assert.ok(job.permissions === undefined || typeof job.permissions === 'object', `${name}: explicit permission map required`);
      assert.ok([undefined, 'read', 'none'].includes(job.permissions?.actions), `${name}: actions write is cleanup-only`);
    }
  }
};

test('should restrict Actions write to the transport deletion job', () => {
  assertActionsPermissions(ci);
  for (const name of Object.keys(jobs).filter(name => name !== 'delete-transport-artifacts')) {
    const changed = structuredClone(ci);
    changed.jobs[name].permissions = { ...changed.jobs[name].permissions, actions: 'write' };
    assert.throws(() => assertActionsPermissions(changed), /actions write is cleanup-only/, name);
    changed.jobs[name].permissions = 'write-all';
    assert.throws(() => assertActionsPermissions(changed), /explicit permission map required/, name);
  }
  const changed = structuredClone(ci);
  changed.permissions.actions = 'write';
  assert.throws(() => assertActionsPermissions(changed));
  changed.permissions = ci.permissions;
  changed.jobs['delete-transport-artifacts'].permissions.contents = 'write';
  assert.throws(() => assertActionsPermissions(changed));
});
const siblingRecipe = makefile.split('pack-candidate-siblings:')[1].split('\npublishable-sibling-plan:')[0];

const assertActionsPermissions = (workflow) => {
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name === 'delete-transport-artifacts') {
      assert.deepEqual(job.permissions, { actions: 'write' });
    } else {
      assert.ok(job.permissions === undefined || typeof job.permissions === 'object', `${name}: explicit permission map required`);
      assert.ok([undefined, 'read', 'none'].includes(job.permissions?.actions), `${name}: actions write is cleanup-only`);
    }
  }
};

test('should restrict Actions write to the transport deletion job', () => {
  assertActionsPermissions(ci);
  for (const name of Object.keys(jobs).filter(name => name !== 'delete-transport-artifacts')) {
    const changed = structuredClone(ci);
    changed.jobs[name].permissions = { ...changed.jobs[name].permissions, actions: 'write' };
    assert.throws(() => assertActionsPermissions(changed), /actions write is cleanup-only/, name);
    changed.jobs[name].permissions = 'write-all';
    assert.throws(() => assertActionsPermissions(changed), /explicit permission map required/, name);
  }
  const changed = structuredClone(ci);
  changed.permissions.actions = 'write';
  assert.throws(() => assertActionsPermissions(changed));
  changed.permissions = ci.permissions;
  changed.jobs['delete-transport-artifacts'].permissions.contents = 'write';
  assert.throws(() => assertActionsPermissions(changed));
});

test('isolated MCP platform build guard admits test environments and refuses other projects', () => {
  const guard = recipe('immo-861-build-mcp-platform').split('\n')[0].replace(/^\t@/, '');
  for (const env of ['test-861-int', 'test-861-gaps', 'test-artifacts-021', 'test-artifacts-022',
    'test-mem-e11', 'test-mem-e11b', 'test-mem-release', 'dev', 'test-unrelated']) {
    const result = spawnSync('/bin/sh', ['-c', guard.replaceAll('$(ENV)', env)], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, ['dev', 'test-unrelated'].includes(env) ? 1 : 0, `${env}: ${result.stderr}`);
  }
});

test('E2 gates run for the final main PR and preserve the reviewed candidate proof', () => {
  const scope = jobs.changes.steps.find((s) => s.id === 'engram_e2_scope');
  const selected = scope.env.SELECTED.slice(3, -3);
  const evaluate = (base, head, changed) => Function('github', 'steps', `return (${selected});`)(
    { base_ref: base, head_ref: head }, { filter: { outputs: { engram_e2: changed } } });
  assert.equal(evaluate('main', 'feat/engram-e2-integration', 'true'), true);
  assert.equal(evaluate('feat/engram-e2-integration', 'feat/memory-lot', 'true'), true);
  assert.equal(evaluate('main', 'feat/unrelated', 'true'), false);
  assert.equal(evaluate('main', 'feat/engram-e2-integration', 'false'), false);
  const steps = jobs['qualify-engram-e2'].steps;
  assert.ok(steps.some((s) => s.run === 'make engram-e2-qualify ENV=test-e2-int'));
  const proof = steps.find((s) => s.name === 'Qualify E11 installed tuple and run generator checks');
  assert.equal(proof['working-directory'], 'tmp/engram-e11-reviewed');
  for (const gate of ['prepare', 'lock', 'installed', 'snapshot', 'generate', 'test', 'check']) {
    assert.ok(proof.run.includes(`memory-e11-${gate}`), `retained E11 ${gate} gate`);
  }
});

test('changes: boolean filter step without file lists plus a separate single-filter JSON list step', () => {
  const steps = jobs.changes.steps;
  const filter = steps.find((s) => s.id === 'filter');
  const files = steps.find((s) => s.id === 'publishable_files');
  assert.equal(filter.uses, 'dorny/paths-filter@ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d');
  assert.equal(files.uses, filter.uses);
  assert.equal(filter.with['list-files'], undefined);
  assert.equal(files.with['list-files'], 'json');
  assert.deepEqual(YAML.parse(files.with.filters), { publishable_package_files: ['packages/*/**'] });
  const comparison = (w) => Object.fromEntries(Object.entries(w).filter(([k]) => !['filters', 'list-files'].includes(k)));
  assert.deepEqual(comparison(files.with), comparison(filter.with), 'identical comparison inputs');
  assert.deepEqual(jobs.changes.permissions, { contents: 'read', 'pull-requests': 'read' });
  const out = jobs.changes.outputs;
  assert.equal(out.package_files, '${{ steps.publishable_files.outputs.publishable_package_files_files }}');
  assert.equal(out.matched_filters, '${{ steps.filter.outputs.changes }}');
  assert.equal(out.manifest_guard, '${{ steps.filter.outputs.manifest_guard }}');
});

test('dedicated manifest_guard filter: only exact image guards also select global qualification', () => {
  const filters = YAML.parse(jobs.changes.steps.find((s) => s.id === 'filter').with.filters);
  assert.deepEqual(filters.manifest_guard, ['scripts/ci/**']);
  const imageGuards = ['scripts/ci/image-receipt.mjs', 'scripts/ci/image-receipt.test.mjs'];
  assert.deepEqual(filters.global.filter(g => g.startsWith('scripts/ci')), imageGuards);
  const candidateGuards = ['package-candidate.mjs', 'package-candidate.test.mjs', 'package-qualification-dag.test.mjs',
    'publishable-manifests.mjs', 'publishable-manifests.test.mjs', 'publishable-pack.test.mjs',
    'qualify-published-install.mjs', 'qualify-published-install.test.mjs'].map(name => `scripts/ci/${name}`);
  assert.deepEqual(filters.package_candidates, candidateGuards);
  for (const [name, globs] of Object.entries(filters)) {
    if (name === 'manifest_guard') continue;
    for (const glob of globs.filter(g => g.startsWith('scripts/ci'))) {
      assert.ok(name === 'global' && imageGuards.includes(glob)
        || name === 'package_candidates' && candidateGuards.includes(glob), `${name} must not include ${glob}`);
    }
  }
});

test('inventory job is always scheduled, credential-free and never a publisher/bootstrap dependency', () => {
  const job = jobs['validate-publishable-manifests'];
  assert.deepEqual(needsOf('validate-publishable-manifests'), ['changes', 'package-candidates']);
  assert.equal(job.if, 'always() && !cancelled() && inputs.decision_fixtures_only != true');
  assert.deepEqual(job.permissions, { contents: 'read' });
  assert.equal(job.env.CI_MANIFEST_CHANGES_RESULT, '${{ needs.changes.result }}');
  for (const [k, v] of Object.entries(CTX)) assert.equal(job.env[k], v);
  const runs = job.steps.map((s) => s.run).filter(Boolean);
  assert.ok(runs.includes('make test-publishable-manifests test-qualify-published-install ENV=test-ci-manifests'));
  assert.ok(runs.includes('make check-publishable-manifests ENV=test-ci-manifests'));
  const upload = job.steps.find((s) => s.uses === 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9');
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with['retention-days'], 7);
  assert.ok(!JSON.stringify(job).includes('secrets.'), 'no registry credentials or OIDC token');
  assert.ok(needsOf('ci-gate').includes('validate-publishable-manifests'), 'the aggregate gate enforces inventory validation');
  assert.ok(needsOf('delete-transport-artifacts').includes('validate-publishable-manifests'), 'cleanup must preserve artifacts after inventory failure');
  for (const name of Object.keys(jobs)) {
    if (['ci-gate', 'ci-capacity-receipts', 'delete-transport-artifacts'].includes(name)) continue;
    assert.ok(!needsOf(name).includes('validate-publishable-manifests'), `${name} must not need the inventory job`);
    assert.ok(!String(jobs[name].if ?? '').includes('validate-publishable-manifests'), `${name} must not gate on the inventory job`);
  }
});

test('ci-gate aggregates every PR validation and cleanup follows its verdict', () => {
  const mainOnly = ['bootstrap-publish', 'verify-train-lock-integrity', 'deploy-preprod'];
  const excluded = (name) => ['ci-gate', 'delete-transport-artifacts'].includes(name) || name.startsWith('publish-') || mainOnly.includes(name);
  const gate = jobs['ci-gate'];
  assert.equal(gate.if, 'always()');
  assert.equal(gate.name, undefined, 'the required context must stay ci-gate');
  assert.deepEqual(gate.permissions, { contents: 'read', actions: 'read' });
  assert.deepEqual([...needsOf('ci-gate')].sort(), Object.keys(jobs).filter((name) => !excluded(name)).sort(), 'every PR job must be in ci-gate.needs');
  for (const name of Object.keys(jobs)) {
    if (name === 'delete-transport-artifacts') assert.ok(needsOf(name).includes('ci-gate'));
    else assert.ok(!needsOf(name).includes('ci-gate'), `${name} must not need ci-gate`);
    if (excluded(name) && !['ci-gate', 'delete-transport-artifacts'].includes(name)) assert.match(String(jobs[name].if ?? ''), /github\.ref == 'refs\/heads\/main'/, `${name} must stay main-only to be excluded`);
  }
});

test('Decision offline mode is explicit, credential-free and cannot publish, while normal gates remain selected', () => {
  const offline = jobs['decision-offline'];
  assert.deepEqual(offline.permissions, { contents: 'read' });
  assert.ok(!JSON.stringify(offline).includes('secrets.'));
  for (const key of ['OPENAI_API_KEY', 'JEV_API_KEY']) assert.equal(offline.env[key], '');
  for (const value of [undefined, false, true]) {
    const lookup = (key) => key === 'inputs.decision_fixtures_only' ? value ?? 'none'
      : key === 'github.event_name' ? 'workflow_dispatch' : key === 'github.ref' ? 'refs/heads/main'
      : key === 'inputs.bootstrap_publish_target' ? 'llm-mesh' : '';
    assert.equal(evaluateSelection(offline.if, lookup), value === true);
    assert.equal(evaluateSelection(jobs['ci-gate'].if, lookup), true, 'the required gate must always run');
    for (const name of ['changes', 'validate-publishable-manifests', 'bootstrap-publish']) {
      assert.equal(evaluateSelection(jobs[name].if, lookup), value !== true, name);
    }
    const releaseLookup = (key) => key === 'needs.changes.result' ? 'success'
      : /^needs\..+\.result$/.test(key) ? 'success' : lookup(key);
    for (const name of ['deploy-preprod', 'verify-train-lock-integrity']) {
      assert.equal(evaluateSelection(jobs[name].if, releaseLookup), value !== true, name);
    }
    // Skipped publishers must still deploy ordinary main changes, never fixtures.
    const skippedLookup = (key) => /^needs\..+\.result$/.test(key) ? 'skipped' : lookup(key);
    assert.equal(evaluateSelection(jobs['deploy-preprod'].if, skippedLookup), value !== true);
  }
  for (const expression of Object.values(ci.env).filter((value) => value.includes('secrets.'))) {
    assert.match(expression, /inputs\.decision_fixtures_only != true && secrets\./);
  }
  const fixtureLookup = (key) => key === 'inputs.decision_fixtures_only' ? true
    : key === 'github.ref' ? 'refs/heads/main' : key === 'github.event_name' ? 'workflow_dispatch'
    : key.endsWith('.result') ? 'skipped' : '';
  for (const [name, job] of Object.entries(jobs)) {
    if (!JSON.stringify(job).includes('secrets.') && !name.startsWith('publish-')) continue;
    assert.equal(evaluateSelection(job.if, fixtureLookup), false, `${name}: fixture dispatch cannot access secrets or publish`);
  }
});

test('Decision fixture dispatch fails the required ci-gate before checkout or artifact access', () => {
  const gate = jobs['ci-gate'];
  assert.equal(gate.if, 'always()');
  assert.equal(gate['continue-on-error'], undefined);
  const refusal = gate.steps[0];
  assert.equal(refusal.if, 'inputs.decision_fixtures_only == true');
  assert.equal(refusal['continue-on-error'], undefined);
  assert.equal(refusal.shell, 'bash');
  for (const ref of ['refs/heads/main', 'refs/heads/feat/decision-host-h1']) {
    for (const value of [undefined, false, true]) {
      const lookup = (key) => key === 'inputs.decision_fixtures_only' ? value ?? 'none'
        : key === 'github.ref' ? ref : key === 'github.event_name' ? 'workflow_dispatch'
        : key.endsWith('.result') ? 'skipped' : '';
      assert.equal(evaluateSelection(gate.if, lookup), true);
      assert.equal(evaluateSelection(refusal.if, lookup), value === true);
    }
  }
  const result = spawnSync('bash', ['-e', '-c', refusal.run], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /::error::Fixture-only run is not merge evidence/);
});

test('Decision provisioning passes names through Compose and optional Kubernetes secret references without credentials or activation defaults', () => {
  const compose = YAML.parse(fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'));
  const deployment = YAML.parseAllDocuments(fs.readFileSync(path.join(root, 'deploy/k8s/base/30-api.yaml'), 'utf8'))
    .map((doc) => doc.toJSON()).find((doc) => doc.kind === 'Deployment');
  const api = deployment.spec.template.spec.containers.find((container) => container.name === 'api');
  for (const [name, variable] of [['JEV_API_KEY', 'JEV'], ['DECISION_EXECUTION_PROFILE', 'DECISION_PROFILE']]) {
    assert.ok(compose.services.api.environment.includes(name === 'JEV_API_KEY' ? `${name}=\${${name}:-}` : name));
    assert.deepEqual(api.env.find((entry) => entry.name === name), {
      name, valueFrom: { secretKeyRef: { name: 'sentropic-api', key: name, optional: true } },
    });
    assert.ok(recipe('k8s-bundle-secret').includes(`${variable}=$$(get ${name})`));
    assert.ok(recipe('k8s-bundle-secret').includes(`--from-literal=${name}="$$${variable}"`));
  }
});

test('publication filters: only packages/<slug>/** triggers a publisher, never root package.json or lockfile', () => {
  const filters = YAML.parse(jobs.changes.steps.find((s) => s.id === 'filter').with.filters);
  const publish = Object.keys(filters).filter((n) => n.endsWith('_publish'));
  assert.ok(publish.length >= STEADY_STATE_PUBLISHERS.length);
  for (const name of publish) {
    const slug = name.slice(0, -'_publish'.length).replace(/_/g, '-');
    assert.deepEqual(filters[name], [`packages/${slug}/**`], name);
  }
  for (const slug of STEADY_STATE_PUBLISHERS) assert.ok(filters[publishFilter(slug)], `${publishFilter(slug)} exists`);
});

test('steady-state publisher mapping and bootstrap expansion match ci.yml', () => {
  const npmPublishers = Object.keys(jobs).filter((n) => /^publish-/.test(n) && !/-image$/.test(n)).map((n) => n.slice('publish-'.length)).sort();
  assert.deepEqual(npmPublishers, [...STEADY_STATE_PUBLISHERS].sort());
  for (const slug of STEADY_STATE_PUBLISHERS) {
    assert.ok(String(jobs[`publish-${slug}`].if).includes(`needs.changes.outputs.${publishFilter(slug)} == 'true'`), `publish-${slug} uses ${publishFilter(slug)}`);
  }
  const bootstrapSteps = jobs['bootstrap-publish'].steps.map((s) => s.run?.match(/^make publish-([a-z-]+)-token /)?.[1]).filter(Boolean);
  assert.deepEqual(bootstrapSteps, BOOTSTRAP_TARGETS);
  const options = ci.on.workflow_dispatch.inputs.bootstrap_publish_target.options.filter((o) => o !== 'none');
  assert.deepEqual([...options].sort(), [...BOOTSTRAP_TARGETS].sort());
  assert.ok(!needsOf('bootstrap-publish').length, 'bootstrap keeps its existing (absent) needs');
});

test('bootstrap publish requires exactly one explicit target: no all option, one declared option per step', () => {
  const input = ci.on.workflow_dispatch.inputs.bootstrap_publish_target;
  assert.ok(!input.options.includes('all'), 'no all option');
  assert.match(input.description, /exactly one explicit package/);
  const declared = input.options.filter((o) => o !== 'none');
  const job = jobs['bootstrap-publish'];
  for (const cond of [job.if, ...job.steps.map((s) => s.if)]) assert.ok(!String(cond ?? '').includes("'all'"), `no condition references all: ${cond}`);
  const guard = job.steps[0];
  assert.equal(guard.name, 'Require one explicit bootstrap target');
  assert.equal(guard.env.BOOTSTRAP_TARGET, '${{ inputs.bootstrap_publish_target }}');
  assert.ok(!guard.run.includes('${{'), 'guard reads the target from env only');
  const allowed = guard.run.match(/^\s*([a-z|-]+)\) ;;$/m)?.[1].split('|');
  assert.deepEqual([...allowed].sort(), [...declared].sort(), 'guard allow-list equals declared options');
  assert.match(guard.run, /\*\) echo "::error[^\n]*exit 1 ;;/);
  const conditioned = job.steps.filter((s) => String(s.if ?? '').includes('bootstrap_publish_target'));
  assert.ok(conditioned.length >= declared.length);
  for (const step of conditioned) {
    const m = String(step.if).match(/^inputs\.bootstrap_publish_target == '([a-z-]+)'$/);
    assert.ok(m, `${step.name}: condition is a single equality`);
    assert.ok(declared.includes(m[1]), `${step.name}: ${m[1]} is a declared option`);
    if (step.run?.startsWith('make publish-')) assert.equal(step.run.match(/^make publish-([a-z-]+)-token /)[1], m[1], `${step.name}: condition matches its target`);
  }
  for (const slug of declared) {
    assert.equal(job.steps.filter((s) => s.if === `inputs.bootstrap_publish_target == '${slug}'` && s.run?.startsWith(`make publish-${slug}-token `)).length, 1, `${slug}: one publish step`);
  }
});

// Owner freeze: these packages must not be published by any path until the owner decides (see rules/workflow.md).
const FROZEN = ['auth-hono'];

test('frozen packages are not bootstrap targets: absent from options, guard allow-list, steps and BOOTSTRAP_TARGETS', () => {
  const job = jobs['bootstrap-publish'];
  const options = ci.on.workflow_dispatch.inputs.bootstrap_publish_target.options;
  const allowed = job.steps[0].run.match(/^\s*([a-z|-]+)\) ;;$/m)?.[1].split('|');
  for (const slug of FROZEN) {
    assert.ok(!options.includes(slug), `${slug}: no dispatch option`);
    assert.ok(!allowed.includes(slug), `${slug}: not in guard allow-list`);
    assert.ok(!BOOTSTRAP_TARGETS.includes(slug), `${slug}: not in BOOTSTRAP_TARGETS`);
    for (const step of job.steps) {
      assert.ok(!String(step.if ?? '').includes(`'${slug}'`), `${slug}: no step condition (${step.name})`);
      assert.ok(!String(step.run ?? '').includes(`publish-${slug}`), `${slug}: no publish step (${step.name})`);
    }
  }
});

// Release train (BRDP-EX10): a train upstream counts as skipped only when its own publish filter is false.
const strictWait = (sibling, filter) => `(needs.${sibling}.result == 'success' || (needs.${sibling}.result == 'skipped' && needs.changes.outputs.${filter} != 'true'))`;
const TRAIN_VALIDATES = [['validate-llm-mesh', 'llm_mesh'], ['validate-llm-gateway', 'llm_gateway'], ['validate-cluster-mesh', 'cluster_mesh']];
const TRAIN_UPSTREAMS = {
  'publish-llm-mesh': [],
  'publish-llm-gateway': [['publish-llm-mesh', 'llm_mesh_publish']],
  'publish-cluster-mesh': [['publish-llm-mesh', 'llm_mesh_publish'], ['publish-llm-gateway', 'llm_gateway_publish'], ['publish-events', 'events_publish'], ['publish-contracts', 'contracts_publish'], ['publish-mcp-platform', 'mcp_platform_publish'], ['publish-artifacts', 'artifacts_publish']],
};

test('publisher ordering: gateway waits for mesh; N1 lockstep siblings gate mcp-auth and cluster-mesh', () => {
  const waits = (job, sibling) => {
    assert.ok(needsOf(job).includes(sibling), `${job} needs ${sibling}`);
    assert.ok(jobs[job].if.includes(`(needs.${sibling}.result == 'success' || needs.${sibling}.result == 'skipped')`));
    assert.ok(jobs[job].if.startsWith('always() &&'));
  };
  waits('publish-mcp-auth', 'publish-oauth-verify');
  for (const [job, upstreams] of Object.entries(TRAIN_UPSTREAMS)) {
    for (const [sibling, filter] of upstreams) {
      assert.ok(needsOf(job).includes(sibling), `${job} needs ${sibling}`);
      assert.ok(jobs[job].if.includes(strictWait(sibling, filter)), `${job} waits strictly for ${sibling}`);
      assert.ok(!jobs[job].if.includes(`needs.${sibling}.result == 'skipped')`), `${job}: no bare skipped for ${sibling}`);
    }
  }
  assert.ok(jobs['publish-mcp-auth'].if.includes("needs.validate-mcp-auth.result == 'success'"));
  assert.ok(jobs['publish-cluster-mesh'].if.includes("needs.validate-cluster-mesh.result == 'success'"));
  for (const slug of STEADY_STATE_PUBLISHERS) {
    assert.deepEqual(jobs[`publish-${slug}`].permissions, { contents: 'read', 'id-token': 'write' });
    assert.ok(needsOf(`publish-${slug}`).includes(`validate-${slug}`));
  }
});

test('every validation pack step receives the CI context and an explicit ENV', () => {
  let count = 0;
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of job.steps ?? []) {
      if (!/\bpack-[a-z-]+/.test(step.run ?? '') || !name.startsWith('validate-') || /pack-candidate-siblings/.test(step.run)) continue;
      count += 1;
      for (const [k, v] of Object.entries(CTX)) assert.equal(step.env?.[k], v, `${name}: ${k}`);
      assert.match(step.run, / ENV=test-ci-[a-z-]+$/);
    }
  }
  // Live speech uses the shared inventory's BLOCK pack and a separate deterministic workflow.
  assert.equal(count, PACK_TARGETS.filter((slug) => !['live-speech', 'cluster-mesh'].includes(slug)).length);
  const producer = jobs['package-candidates'];
  for (const [k, v] of Object.entries(CTX)) assert.equal(producer.env[k], v);
  assert.deepEqual(needsOf('package-candidates'), ['changes']);
  assert.ok(producer.steps.some(step => step.run === 'make ci-package-candidate ENV=test-ci-br80'));
  assert.match(recipe('ci-package-candidate'), /CM_ACTION=candidate CI_PACKAGE_CANDIDATES=tmp\/ci-package-candidates/);
  const prepare = fs.readFileSync(path.join(root, 'packages/cluster-mesh/tests/storage/cold-workspace.sh'), 'utf8');
  assert.match(prepare, /package-candidate\.mjs produce "\$CI_PACKAGE_CANDIDATES" cluster-mesh/);
  assert.ok(PACK_TARGETS.includes('live-speech'));
  assert.ok(jobs['validate-publishable-manifests'].steps.some((step) =>
    step.run === 'make check-publishable-manifests ENV=test-ci-manifests'));
  const speech = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/live-speech.yml'), 'utf8'));
  const speechRuns = speech.jobs['validate-live-speech'].steps.map((step) => step.run);
  for (const gate of ['typecheck', 'lint', 'test', 'build']) {
    assert.ok(speechRuns.includes(`make ${gate}-live-speech ENV=test-stt-l2`));
  }
});

test('lint wiring follows baseline evidence, independently per package, before typecheck', () => {
  for (const [slug, baseline] of Object.entries(LINT_BASELINE)) {
    const steps = jobs[`validate-${slug}`].steps;
    const runs = slug === 'cluster-mesh' ? recipe('ci-package-qualification') : steps.map(s => s.run ?? '').join('\n');
    const lint = runs.indexOf(`lint-${slug}`);
    const typecheck = runs.indexOf(slug === 'cluster-mesh' ? 'typecheck-cluster-mesh' : `CM_ACTION=${slug === 'llm-mesh' ? 'mesh' : 'gateway'}-check`);
    if (baseline === 'pass') {
      assert.ok(lint > 0 && lint < typecheck, `${slug} lint wired before typecheck`);
      const step = steps.find(s => s.run?.includes(slug === 'cluster-mesh' ? 'make ci-package-qualification ' : `make lint-${slug} `));
      assert.equal(step.env, undefined);
      assert.equal(step['continue-on-error'], undefined);
      if (slug === 'cluster-mesh') {
        assert.ok(jobs['validate-cluster-mesh'].strategy.matrix.include.some(row => row.lane.split(' ').includes('source')));
        assert.match(runs, /source\).*lint-cluster-mesh typecheck-cluster-mesh test-cluster-mesh/);
      } else {
        const prepare = fs.readFileSync(path.join(root, 'packages/cluster-mesh/tests/storage/cold-workspace.sh'), 'utf8');
        assert.match(prepare, /mesh-check\|gateway-check\)[\s\S]*"\$tsc" --noEmit -p tsconfig\.json/);
        assert.match(prepare, /"\$tsc" --noEmit -p tsconfig\.json[\s\S]*vitest run tests/);
      }
    } else assert.equal(lint, -1, `${slug} failed baseline must stay unwired`);
    assert.ok(new RegExp(`^lint-llm-mesh lint-llm-gateway lint-cluster-mesh: lint-%:`, 'm').test(makefile));
  }
});

// Release train (BRDP-EX10): every cluster-mesh leaf imports its optional peers (release-matrix tuple).
const CLUSTER_MESH_PEERS = ' PEERS=@sentropic/llm-mesh@0.30.0,@sentropic/llm-gateway@0.21.5,@sentropic/mcp-auth@0.2.1,@sentropic/auth-hono@0.17.0,@sentropic/artifacts@0.2.0,jose@5.10.0,@sentropic/comments@0.3.1';

test('cluster-mesh qualification installs every declared optional Sentropic peer', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/cluster-mesh/package.json'), 'utf8'));
  const required = Object.keys(manifest.peerDependencies).filter((name) =>
    name.startsWith('@sentropic/') && manifest.peerDependenciesMeta?.[name]?.optional);
  const steps = [
    { name: 'Cluster Mesh candidate install lane', run: recipe('ci-package-qualification').match(/install\) exec (.*) ;;/)?.[1] },
    jobs['publish-cluster-mesh'].steps.find((s) => s.run?.includes('make qualify-published-install PKG=')),
    jobs['bootstrap-publish'].steps.find((s) => s.name === 'Qualify bootstrap-published cluster-mesh'),
  ];
  for (const step of steps) {
    const peers = step.run.match(/\bPEERS=(\S+)/)?.[1].split(',') ?? [];
    assert.equal(` PEERS=${peers.join(',')}`, CLUSTER_MESH_PEERS, `${step.name}: complete release tuple`);
    assert.ok(!peers.some((spec) => spec.startsWith('@sentropic/mcp-platform@')), 'platform resolves transitively');
    for (const name of required) {
      assert.ok(peers.some((spec) => spec.startsWith(`${name}@`)), `${step.name}: missing optional peer ${name}`);
    }
  }
});

test('candidate and post-publication qualification for mcp-auth and cluster-mesh', () => {
  for (const [slug, peers] of [['mcp-auth', ' PEERS=hono@4.10.7'], ['cluster-mesh', CLUSTER_MESH_PEERS]]) {
    const steps = jobs[`validate-${slug}`].steps;
    if (slug === 'cluster-mesh') {
      assert.deepEqual(needsOf('validate-cluster-mesh'), ['changes', 'package-candidates']);
      assert.equal(jobs['validate-cluster-mesh'].env.CI_PACKAGE_CANDIDATES, 'tmp/ci-package-candidates');
      const verify = steps.findIndex(s => s.run === 'make ci-package-verify ENV=test-ci-br80');
      const siblings = steps.findIndex(s => s.run === 'make pack-candidate-siblings PACKAGE=cluster-mesh SIBLING_DIR=tmp/ci-manifest-guard/siblings/cluster-mesh ENV=test-ci-br80');
      const qualify = steps.findIndex(s => s.run?.includes('make ci-package-qualification PACKAGE_LANE="$lane" ENV=test-ci-br80-$lane'));
      assert.ok(verify >= 0 && verify < siblings && siblings < qualify);
      for (const index of [verify, siblings, qualify]) assert.equal(steps[index].if, undefined);
      assert.match(recipe('ci-package-qualification'), /install\) exec \$\(MAKE\) qualify-published-install TARBALL="\$\$tarball" SIBLING_ARCHIVES_FILE=tmp\/ci-manifest-guard\/siblings\/cluster-mesh\/receipts\.json/);
    } else {
      const pack = steps.find((s) => s.id === 'pack');
      assert.equal(pack.run, `make pack-${slug} PACK_DESTINATION=tmp/ci-manifest-guard/candidate/${slug} PACK_OUTPUT_FILE="$GITHUB_OUTPUT" ENV=test-ci-${slug}`);
      const siblings = steps.find((s) => s.run?.startsWith('make pack-candidate-siblings '));
      const qualify = steps.find((s) => s.run?.startsWith('make qualify-published-install TARBALL='));
      assert.equal(siblings.run, `make pack-candidate-siblings PACKAGE=${slug} SIBLING_DIR=tmp/ci-manifest-guard/siblings/${slug} ENV=test-ci-${slug}`);
      assert.equal(siblings.if, "steps.pack.outputs.manifest_mode == 'block'");
      for (const [key, value] of Object.entries(CTX)) assert.equal(siblings.env[key], value);
      assert.ok(steps.indexOf(pack) < steps.indexOf(siblings) && steps.indexOf(siblings) < steps.indexOf(qualify), `${slug}: pack candidate and siblings before qualification`);
      assert.equal(qualify.if, "steps.pack.outputs.manifest_mode == 'block'");
      assert.equal(qualify.env.CANDIDATE_TARBALL, '${{ steps.pack.outputs.tarball }}');
      assert.equal(qualify.run, `make qualify-published-install TARBALL="$CANDIDATE_TARBALL" SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/${slug}/receipts.json${peers} REPORT_DIR=tmp/ci-manifest-guard/qualify-${slug} ENV=test-ci-${slug}`);
    }
    const publish = jobs[`publish-${slug}`].steps;
    const at = publish.findIndex((s) => s.run === `make publish-${slug}`);
    assert.match(publish[at + 1].run, new RegExp(`publish/${slug}\\.publish-output`));
    // Release train (BRDP-EX10, BRCIW-EX3 for mcp-auth): an equal-integrity conflict is qualified at once; a plain
    // skip is healed only on a re-run, after a cache-busted, retried presence check, with the run id so that a
    // version published by an earlier run is a stale skip (notice) rather than a red provenance check.
    const run = publish[at + 1].run;
    assert.match(run, /conflict="\$\(sed -n 's\/\^conflict=\/\/p' "\$receipt"\)"\n\s*provenance_run=\n/, `${slug}: reads the conflict kind`);
    assert.match(run, /case "\$status" in\n\s*published\) ;;\n\s*skipped\)\n\s*if \[ "\$conflict" = equal-integrity \]; then echo "::notice [^\n]*"\n\s*else\n\s*if \[ "\$GITHUB_RUN_ATTEMPT" -le 1 \]; then echo "::notice [^\n]*"; exit 0; fi\n/, `${slug}: first attempt: a plain skip is a prior publication`);
    assert.match(run, /if ! curl -fsS --retry 3 --retry-all-errors -o \/dev\/null -H 'cache-control: no-cache' "https:\/\/registry\.npmjs\.org\/[^\n]*\?cachebust=\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}-\$\(date \+%s\)"; then echo "::error [^\n]*absent from the registry"; exit 1; fi\n\s*provenance_run="\$GITHUB_RUN_ID"\n/, `${slug}: cache-busted presence check, then run-scoped heal`);
    assert.ok(!run.includes('qualify-report.json'), 'no dead report existence test');
    const reportDir = slug === 'cluster-mesh' ? 'REPORT_DIR="\\$report_dir"' : `REPORT_DIR=tmp\\/ci-manifest-guard\\/qualify-${slug}`;
    const wait = slug === 'cluster-mesh' ? ' QUALIFY_WAIT_ATTEMPTS=36' : '';
    assert.match(run, new RegExp(`\\*\\) echo "::error [^\\n]*unexpected publication outcome"; exit 1 ;;\\n\\s*esac\\n\\s*make qualify-published-install PKG="\\$pkg" PEERS=\\S+ QUALIFY_MODE=post-publication ${reportDir}${wait} QUALIFY_PROVENANCE_SHA="\\$GITHUB_SHA" QUALIFY_PROVENANCE_RUN="\\$provenance_run" ENV=test-ci-${slug}\\n?$`), `${slug}: exact qualification command`);
    if (slug === 'cluster-mesh') assert.match(run, /\n\s*report_dir=tmp\/ci-manifest-guard\/qualify-cluster-mesh\n/);
    assert.ok(run.includes(`make qualify-published-install PKG="$pkg"${peers} QUALIFY_MODE=post-publication `), 'post-publication qualification imports every leaf with its optional peers');
    const bootstrap = jobs['bootstrap-publish'].steps.find((s) => s.name === `Qualify bootstrap-published ${slug}`);
    assert.ok(bootstrap.run.includes(`make qualify-published-install PKG="$pkg"${peers} QUALIFY_MODE=post-publication `), 'bootstrap qualification uses the same optional peers');
    assert.ok(!/SIBLING_ARCHIVES_FILE|TARBALL=/.test(publish[at + 1].run), 'registry-only after publication');
    assert.equal(publish[at + 2].if, 'always()');
  }
});

test('release train: validation barrier, strict chain, serialization, lock-sync and lock integrity (BRDP-EX10)', () => {
  const validated = TRAIN_VALIDATES.map(([job, filter]) => `(needs.${job}.result == 'success' || (needs.${job}.result == 'skipped' && needs.changes.outputs.${filter} != 'true' && needs.changes.outputs.global != 'true'))`);
  for (const [job, upstreams] of Object.entries(TRAIN_UPSTREAMS)) {
    const cond = jobs[job].if.replaceAll("(github.ref == 'refs/heads/main' || inputs.capacity_publish_dry_run == true)", "github.ref == 'refs/heads/main'");
    const slug = job.slice('publish-'.length);
    // `!cancelled()` instead of design section 5's `always()`: a manual cancel stops the train.
    assert.ok(cond.startsWith(`!cancelled() && needs.changes.result == 'success' && github.ref == 'refs/heads/main' && needs.changes.outputs.${publishFilter(slug)} == 'true' && `), `${job}: barrier prefix`);
    assert.equal(cond, [cond.slice(0, cond.indexOf(' && (')), ...validated, ...upstreams.map(([s, f]) => strictWait(s, f))].join(' && '), `${job}: exact condition`);
    assert.deepEqual(needsOf(job), ['changes', ...TRAIN_VALIDATES.map(([v]) => v), ...upstreams.map(([s]) => s)], `${job}: needs`);
    assert.deepEqual(jobs[job].concurrency, { group: 'npm-publish-train', 'cancel-in-progress': false }, `${job}: concurrency`);
  }
  for (const name of Object.keys(jobs)) {
    if (!(name in TRAIN_UPSTREAMS)) assert.notEqual(jobs[name].concurrency?.group, 'npm-publish-train', `${name}: not in the train group`);
  }
  const sync = jobs.changes.steps.find((s) => s.name === 'Assert train package versions match the root lockfile');
  assert.ok(jobs.changes.steps.indexOf(sync) < jobs.changes.steps.findIndex((s) => s.id === 'filter'), 'lock-sync before the filters');
  assert.match(sync.run, /for slug in llm-mesh llm-gateway cluster-mesh; do/);
  assert.match(sync.run, /jq -r --arg key "packages\/\$\{slug\}" '\.packages\[\$key\]\.version \/\/ "missing"' package-lock\.json/);
  assert.match(sync.run, /if \[ "\$manifest" != "\$locked" \]; then\n\s*echo "::error [^\n]*"\n\s*exit 1/);
  const verify = jobs['verify-train-lock-integrity'];
  assert.deepEqual(needsOf('verify-train-lock-integrity'), ['changes', 'publish-llm-mesh', 'publish-llm-gateway']);
  assert.equal(verify.if, "!cancelled() && inputs.decision_fixtures_only != true && needs.changes.result == 'success' && github.ref == 'refs/heads/main' && (needs.publish-llm-mesh.result == 'success' || needs.publish-llm-gateway.result == 'success')");
  assert.deepEqual(verify.permissions, { contents: 'read' });
  const check = verify.steps.find((s) => /check-train-lock-integrity/.test(s.run ?? ''));
  assert.deepEqual(check.env, { LLM_MESH_PUBLISH_RESULT: '${{ needs.publish-llm-mesh.result }}', LLM_GATEWAY_PUBLISH_RESULT: '${{ needs.publish-llm-gateway.result }}' });
  assert.match(check.run, /if \[ "\$LLM_MESH_PUBLISH_RESULT" = success \]; then required="@sentropic\/llm-mesh"; fi/);
  assert.match(check.run, /if \[ "\$LLM_GATEWAY_PUBLISH_RESULT" = success \]; then required="[^\n]*@sentropic\/llm-gateway"; fi/);
  assert.match(check.run, /make -f packages\/cluster-mesh\/packaging\.mk check-train-lock-integrity REQUIRE_PUBLISHED="\$required" ENV=test-ci-cluster-mesh$/m);
  assert.ok(needsOf('delete-transport-artifacts').includes('verify-train-lock-integrity'), 'cleanup must preserve artifacts after integrity failure');
  for (const name of Object.keys(jobs).filter(name => name !== 'delete-transport-artifacts')) {
    assert.ok(!needsOf(name).includes('verify-train-lock-integrity'), `${name}: integrity check never stops the chain`);
  }
  const steps = jobs['validate-cluster-mesh'].steps;
  const index = (pattern) => steps.findIndex((s) => pattern.test(s.run ?? ''));
  const qualify = index(/make ci-package-qualification /);
  assert.ok(index(/make ci-package-verify /) >= 0 && index(/make ci-package-verify /) < index(/make pack-candidate-siblings /)
    && index(/make pack-candidate-siblings /) < qualify, 'candidate and siblings verified before every qualification lane');
  const dispatch = recipe('ci-package-qualification');
  assert.match(dispatch, /lazy\).*packaging\.mk test-lazy-package SIBLING_ARCHIVES_FILE=tmp\/ci-manifest-guard\/siblings\/cluster-mesh\/receipts\.json ENV=\$\(ENV\)/);
  for (const target of ['cluster-mesh-comments-installed', 'cluster-mesh-pg-major-upgrade']) {
    assert.ok(dispatch.includes(`target=${target}`), target);
  }
  assert.match(dispatch, /"\$\$target" CM_COMMENTS_TARBALL="\$\$tarball" SIBLING_ARCHIVES_FILE=tmp\/ci-manifest-guard\/siblings\/cluster-mesh\/receipts\.json/);
  assert.equal(steps[qualify].if, undefined, 'qualification always runs for each selected lane');
  for (const lane of ['lazy', 'installed', 'major', 'install']) {
    assert.ok(jobs['validate-cluster-mesh'].strategy.matrix.include.some(row => row.lane.split(' ').includes(lane)), lane);
  }
});

test('Makefile: every pack lane is a real guarded pack; no dry-run or raw publish remains', () => {
  for (const slug of PACK_TARGETS) assert.match(recipe(`pack-${slug}`) ?? '', new RegExp(`\\$\\(call manifest_guard_pack,${slug}[,)]`), `pack-${slug}`);
  assert.ok(!/npm pack --dry-run/.test(makefile));
  assert.match(recipe('pack-chat-ui'), /manifest_guard_pack,chat-ui,\$\(MANIFEST_DIST_FORM\)/);
  assert.match(recipe('pack-cited-source-viewer'), /manifest_guard_pack,cited-source-viewer,\$\(MANIFEST_DIST_FORM\)/);
  const publishRecipes = [...makefile.matchAll(/^(publish-[a-z-]+):[^\n]*\n((?:\t[^\n]*\n?)+)/gm)].filter(([, n]) => !/-image$/.test(n));
  assert.equal(publishRecipes.length, STEADY_STATE_PUBLISHERS.length * 2, 'OIDC + token recipe per package');
  for (const [, name, body] of publishRecipes) {
    const slug = name.replace(/^publish-/, '').replace(/-token$/, '');
    assert.match(body, new RegExp(`\\$\\(call manifest_guard_publish,${slug},--access public`), name);
    assert.ok(!/npm publish/.test(body), `${name} never publishes a directory`);
    if (name.endsWith('-token')) assert.match(body, /NPM_TOKEN_FILE/);
    else assert.match(body, /-e ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  }
  for (const slug of STEADY_STATE_PUBLISHERS) {
    assert.match(recipe(`publish-${slug}-token`) ?? '', new RegExp(`\\$\\(call manifest_guard_publish,${slug},--access public --provenance=false\\)`), `publish-${slug}-token disables provenance on the token path`);
    assert.doesNotMatch(recipe(`publish-${slug}`) ?? '', /provenance/, `publish-${slug} keeps provenance for OIDC publishes`);
  }
  assert.match(recipe('publish-chat-ui'), /make-publish-pkgjson.mjs --write; export MANIFEST_ORIGINAL_SOURCE=/);
});

test('sibling directory guard derives the directory from the slug and rejects anything else before any deletion', () => {
  const script = path.join(root, 'scripts', 'ci', 'check-publishable-manifests.sh');
  const run = (dir, { slug = 'foo', gitIn } = {}) => {
    // Throwaway cwd with a sentinel under tmp/ and a `make` stub that logs and fails (no real make/Docker).
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sibling-guard-'));
    try {
      fs.mkdirSync(path.join(work, 'tmp', 'keep'), { recursive: true });
      fs.writeFileSync(path.join(work, 'tmp', 'keep', 'sentinel'), 'x');
      if (gitIn) fs.mkdirSync(path.join(work, gitIn, '.git'), { recursive: true });
      fs.mkdirSync(path.join(work, 'bin'));
      fs.writeFileSync(path.join(work, 'bin', 'make'), '#!/bin/sh\necho "$*" >> "$MAKE_LOG"\nexit 1\n', { mode: 0o755 });
      const makeLog = path.join(work, 'make.log');
      const r = spawnSync('bash', [script, 'test-env', 'siblings', slug, dir], { cwd: work, encoding: 'utf8', env: { ...process.env, PATH: `${path.join(work, 'bin')}:${process.env.PATH}`, MAKE_LOG: makeLog } });
      return {
        ...r,
        made: fs.existsSync(makeLog) ? fs.readFileSync(makeLog, 'utf8') : '',
        sentinel: fs.existsSync(path.join(work, 'tmp', 'keep', 'sentinel')),
        gitKept: gitIn ? fs.existsSync(path.join(work, gitIn, '.git')) : true,
        receipts: fs.existsSync(path.join(work, 'tmp', 'ci-manifest-guard', 'siblings', 'foo', 'receipts')),
      };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  };
  const rejected = [
    ['tmp/'], ['tmp/.'], ['tmp//'], ['tmp/./x'], ['tmp/../x'], ['/tmp/x'], ['x'], ['tmp'], ['tmp/x/'], ['tmp/.hidden'], ['tmp/a b'],
    ['tmp/keep'], ['tmp/ci-manifest-guard'], ['tmp/cluster-mesh-lazy-surface'], ['tmp/ci-manifest-guard/siblings/bar'],
    ['tmp/\ntmp/x'], ['tmp/x\n/'], ['/\ntmp/x'], ['tmp/a*b'], ['tmp/a?x'], ['tmp/a[x]'],
    ['tmp/ci-manifest-guard/siblings/foo\n', { slug: 'foo\n' }], ['tmp/ci-manifest-guard/siblings/foo\ntmp', { slug: 'foo\ntmp' }],
    ['tmp/ci-manifest-guard/siblings/foo', { gitIn: 'tmp/ci-manifest-guard/siblings/foo' }],
  ];
  for (const [dir, opts] of rejected) {
    const label = JSON.stringify([dir, opts]);
    const r = run(dir, opts);
    assert.equal(r.status, 1, `${label} must be rejected`);
    assert.match(r.stdout, /ERROR: (sibling directory|invalid package slug)/, label);
    assert.ok(r.sentinel, `${label}: tmp/ must be untouched`);
    assert.ok(r.gitKept, `${label}: a checkout with .git must be untouched`);
    assert.equal(r.made, '', `${label}: rejected before any make call`);
  }
  const ok = run('tmp/ci-manifest-guard/siblings/foo');
  assert.equal(ok.status, 1, 'stubbed make fails after the guard');
  assert.doesNotMatch(ok.stdout, /ERROR: sibling directory/);
  assert.ok(ok.receipts);
  assert.ok(ok.sentinel);
  assert.match(ok.made, /^publishable-sibling-plan PACKAGE=foo SIBLING_DIR=tmp\/ci-manifest-guard\/siblings\/foo ENV=test-env$/m);
});

test('sibling Make targets gate PACKAGE/SIBLING_DIR on the host before docker and pass them as container env', () => {
  assert.match(makefile, /^SIBLING_ARGS_GATE = \$\(if \$\(and \$\(filter 1,\$\(words \$\(PACKAGE\)\)\),.*\$\(error /m);
  for (const target of ['pack-candidate-siblings', 'publishable-sibling-plan']) {
    assert.match(recipe(target).split('\n')[0], /^\t\$\(SIBLING_ARGS_GATE\)$/, `${target}: host gate is the first recipe line`);
  }
  assert.match(siblingRecipe, /siblings '\$\(PACKAGE\)' '\$\(SIBLING_DIR\)'/);
  assert.match(siblingRecipe, /ifneq \(\$\(CI_PACKAGE_CANDIDATES\),\)/);
  assert.match(siblingRecipe, /package-candidate\.mjs siblings "\$\(CI_PACKAGE_CANDIDATES\)" "\$\(PACKAGE\)" "\$\(SIBLING_DIR\)"/);
  const r = recipe('publishable-sibling-plan');
  assert.ok(r.indexOf("@case '$(PACKAGE)' in") < r.indexOf('$(ARTIFACTS_RUN)'), 'host slug check before container launch');
  assert.match(r, /-e PACKAGE="\$\(PACKAGE\)" -e SIBLING_DIR="\$\(SIBLING_DIR\)"/);
  const inner = r.slice(r.indexOf("sh -lc '"));
  assert.ok(!/\$\((?:PACKAGE|SIBLING_DIR)\)/.test(inner), 'no Make interpolation inside the container script');
  assert.match(inner, /--slug "\$\$PACKAGE"/);
  assert.match(inner, /\[ "\$\$SIBLING_DIR" = "tmp\/ci-manifest-guard\/siblings\/\$\$PACKAGE" \]/);
});

test('post-publication qualification fails on a missing or status-less receipt', () => {
  const steps = Object.values(jobs).flatMap((j) => j.steps ?? [])
    .filter((s) => /Qualify (published|bootstrap-published)/.test(s.name ?? ''));
  assert.equal(steps.length, 4);
  for (const s of steps) {
    assert.ok(!/:-missing/.test(s.run), s.name);
    assert.match(s.run, /if \[ ! -f "\$receipt" \]; then echo "::error title=Publication qualification::.*"; exit 1; fi/, s.name);
    assert.match(s.run, /if \[ -z "\$status" \]; then echo "::error title=Publication qualification::.*"; exit 1; fi/, s.name);
  }
});

// BRDP-EX11: run the host guard lines of qualify-published-install (before mkdir/docker) with sh, one shell per line as Make does.
const runQualifyGuards = (overrides) => {
  const vars = { QUALIFY_WAIT_ATTEMPTS: '18', QUALIFY_WAIT_SECONDS: '10', ...overrides };
  const lines = recipe('qualify-published-install').split('\n');
  const guards = lines.slice(0, lines.findIndex((l) => l.startsWith('\t@mkdir')));
  for (const line of guards) {
    const cmd = line.replace(/^\t@/, '').replace(/\$\(([A-Z_]+)\)/g, (_, k) => vars[k] ?? '').replaceAll('$$', '$');
    const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
    if (r.status !== 0) return { status: r.status, out: r.stdout + r.stderr };
  }
  return { status: 0, out: '' };
};

test('qualify-published-install: TARBALL mode without PEERS/QUALIFY_MODE passes the character guard; invalid PEERS still refused', () => {
  const tgz = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qguard-')), 'candidate.tgz');
  fs.writeFileSync(tgz, '');
  assert.deepEqual(runQualifyGuards({ TARBALL: tgz }), { status: 0, out: '' });
  const missing = runQualifyGuards({ TARBALL: `${tgz}.absent` });
  assert.equal(missing.status, 1);
  assert.match(missing.out, /ERROR: TARBALL .* is not a file/);
  const bad = runQualifyGuards({ TARBALL: tgz, PEERS: 'a@1;rm' });
  assert.equal(bad.status, 1);
  assert.match(bad.out, /ERROR: PKG\/PEERS\/QUALIFY_MODE contain unsupported characters/);
  assert.equal(runQualifyGuards({ TARBALL: tgz, PEERS: '@x/a@1.0.0,b@2.0.0', QUALIFY_MODE: 'registry' }).status, 0);
});

test('qualify-published-install: registry wait budget defaults to 18 x 10 s and only accepts integers', () => {
  assert.match(makefile, /^QUALIFY_WAIT_ATTEMPTS \?= 18$/m);
  assert.match(makefile, /^QUALIFY_WAIT_SECONDS \?= 10$/m);
  assert.match(recipe('qualify-published-install'), /--attempts "\$\(QUALIFY_WAIT_ATTEMPTS\)" --delay "\$\(QUALIFY_WAIT_SECONDS\)"/);
  const tgz = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qguard-')), 'candidate.tgz');
  fs.writeFileSync(tgz, '');
  for (const bad of [{ QUALIFY_WAIT_ATTEMPTS: '0' }, { QUALIFY_WAIT_ATTEMPTS: '1;x' }, { QUALIFY_WAIT_SECONDS: 'ten' }, { QUALIFY_WAIT_SECONDS: '' }]) {
    assert.match(runQualifyGuards({ TARBALL: tgz, ...bad }).out, /QUALIFY_WAIT_ATTEMPTS\/QUALIFY_WAIT_SECONDS must be integers/, JSON.stringify(bad));
  }
});

test('steady-state OIDC post-publication qualification checks the SLSA provenance commit; bootstrap token publishes do not', () => {
  for (const slug of ['mcp-auth', 'cluster-mesh']) {
    const publish = jobs[`publish-${slug}`].steps;
    const step = publish[publish.findIndex((s) => s.run === `make publish-${slug}`) + 1];
    assert.match(step.run, /make qualify-published-install PKG="\$pkg" [^\n]* QUALIFY_PROVENANCE_SHA="\$GITHUB_SHA" QUALIFY_PROVENANCE_RUN="\$provenance_run" ENV=test-ci-/, slug);
    const bootstrap = jobs['bootstrap-publish'].steps.find((s) => s.name === `Qualify bootstrap-published ${slug}`);
    assert.ok(!bootstrap.run.includes('QUALIFY_PROVENANCE_SHA'), `${slug}: bootstrap publishes carry no provenance`);
  }
  assert.match(recipe('qualify-published-install'), /\$\(if \$\(QUALIFY_PROVENANCE_SHA\),--provenance-commit "\$\(QUALIFY_PROVENANCE_SHA\)"\)/);
  const tgz = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qguard-')), 'candidate.tgz');
  fs.writeFileSync(tgz, '');
  assert.equal(runQualifyGuards({ TARBALL: tgz, QUALIFY_PROVENANCE_SHA: 'a'.repeat(40) }).status, 0);
  for (const bad of ['HEAD', 'A'.repeat(40), `${'a'.repeat(40)};x`]) {
    assert.match(runQualifyGuards({ TARBALL: tgz, QUALIFY_PROVENANCE_SHA: bad }).out, /QUALIFY_PROVENANCE_SHA must be a 40-hex commit SHA/, bad);
  }
  assert.match(recipe('qualify-published-install'), /\$\(if \$\(QUALIFY_PROVENANCE_RUN\),--provenance-run "\$\(QUALIFY_PROVENANCE_RUN\)"\)/);
  assert.equal(runQualifyGuards({ TARBALL: tgz, QUALIFY_PROVENANCE_RUN: '36222109704' }).status, 0);
  for (const bad of ['0', 'abc', '12;x']) {
    assert.match(runQualifyGuards({ TARBALL: tgz, QUALIFY_PROVENANCE_RUN: bad }).out, /QUALIFY_PROVENANCE_RUN must be a numeric run id/, bad);
  }
});

test('Cluster Mesh publication tolerates registry visibility beyond the old 18-read budget', async () => {
  const step = jobs['publish-cluster-mesh'].steps.find((s) => s.name === 'Qualify published Cluster Mesh from the registry');
  const attempts = Number(step.run.match(/QUALIFY_WAIT_ATTEMPTS=(\d+)/)?.[1]);
  assert.equal(attempts, 36);
  assert.match(makefile, /^QUALIFY_WAIT_SECONDS \?= 10$/m);
  for (const visibleAt of [20, Infinity]) {
    let reads = 0;
    const registry = { lookup: async (name, version, opts) => {
      assert.equal(name, '@sentropic/cluster-mesh');
      assert.equal(version, '0.21.3');
      assert.deepEqual(opts, { fresh: true });
      reads += 1;
      return { status: reads >= visibleAt ? 'present' : 'absent' };
    } };
    const found = await waitForVersion(registry, '@sentropic/cluster-mesh', '0.21.3', { attempts, delaySeconds: 0 });
    assert.equal(found.status, visibleAt === Infinity ? 'absent' : 'present');
    assert.equal(reads, Math.min(visibleAt, attempts));
  }
});

test('gateway mesh wait resolves a union range to an exact dependency floor', () => {
  for (const [range, expected] of [['^0.27.0', '0.27.0'], ['^0.27.0 || ^0.28.0', '0.27.0'],
    ['^0.28.0', '0.28.0'], ['>=0.28.1 <0.29.0', '0.28.1']]) assert.equal(dependencyFloor(range), expected);
  for (const range of ['', 'latest', 'file:../llm-mesh', '>2.0.0 <1.0.0']) {
    assert.throws(() => dependencyFloor(range));
  }
  const command = recipe('wait-llm-gateway-mesh-dependency').match(/version="\$\$\((.*?)\)"; node /)?.[1];
  assert.ok(command, 'execute the real Make version selector without polling the registry');
  const result = spawnSync('sh', ['-ec', command], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '0.28.0');
});

test('llm-gateway registry waits bypass caches with the 18 x 10 s budget', () => {
  assert.match(makefile, /^LLM_MESH_REGISTRY_WAIT_ATTEMPTS \?= 18$/m);
  assert.match(makefile, /^LLM_MESH_REGISTRY_WAIT_SECONDS \?= 10$/m);
  const mesh = recipe('wait-llm-gateway-mesh-dependency');
  assert.match(mesh, /publishable-manifests\.mjs wait --spec "@sentropic\/llm-mesh@\$\$version"/);
  assert.ok(mesh.includes('dependencyFloor'), 'a union range resolves to its exact floor, never a caret-stripped fragment');
  assert.ok(!mesh.includes('npm view'), 'no cached npm view poll');
  assert.ok(!mesh.includes('#^'), 'the full declared range is resolved, never caret-stripped');
  assert.match(recipe('wait-llm-gateway-auth-dependencies'), /npm_config_prefer_online=true node scripts\/auth-registry\.mjs/);
  assert.match(makefile, /^manifest_guard_publish = .* publish --slug \$\(1\) --wait-attempts "\$\(LLM_MESH_REGISTRY_WAIT_ATTEMPTS\)" --wait-delay "\$\(LLM_MESH_REGISTRY_WAIT_SECONDS\)" -- \$\(2\)$/m, 'publish conflict re-read uses the Make wait budget');
});
