// Filter repair regression tests (make test-ci-optimization).
// Repaired selection is the union of the existing selection and the qualified
// required consumers from scripts/ci/fixtures/consumer-regressions.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  SELECTION_KEYS, hasUnresolvedInput, hasValidSelectionOutputs,
  matchGlob,
  qualifyHistoricalExclusion,
  requiredSuccessJobs,
  selectedFilters,
  selectedJobs,
} from './filter-consumers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
const complianceSh = fs.readFileSync(path.join(root, 'scripts', 'security', 'security-compliance.sh'), 'utf8');
const councilRefresh = fs.readFileSync(path.join(root, 'scripts', 'llm-model-equivalences', 'refresh.mjs'), 'utf8');
const filters = YAML.parse(ci.jobs.changes.steps.find((s) => s.id === 'filter').with.filters);
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'ci', 'fixtures', 'consumer-regressions.json'), 'utf8'),
);

test('history dataset: all 181 runs (74 non-fallback, 107 fallback, 4 LLM) are present with original IDs and paths', () => {
  assert.equal(fixture.historicalRuns.length, 181);
  assert.equal(fixture.historicalRuns.filter((r) => r.fallback === null).length, 74);
  assert.equal(fixture.historicalRuns.filter((r) => r.fallback === 'unresolved-input').length, 107);
  assert.equal(fixture.historicalRuns.filter((r) => r.ai.length > 0).length, 4);
  for (const run of fixture.historicalRuns) {
    assert.ok(Number.isInteger(run.id) && run.id > 0, `valid run id ${run.id}`);
    const paths = fixture.pathSets[run.pathSet];
    assert.ok(Array.isArray(paths) && paths.length > 0, `run ${run.id} has non-empty paths`);
    assert.equal(hasUnresolvedInput(filters, paths), false, `run ${run.id} has no unresolved input path`);
  }
});

test('executable replay of all 181 historical runs: every omitted variant is selected or code-qualified', () => {
  const iacRecipe = makefile.match(/^test-security-iac:[^\n]*\n((?:\t[^\n]*\n?)+)/m)?.[1] ?? '';
  for (const re of [/\/src\/docker-compose\.yml/, /\/src\/Makefile/, /scripts\/security\/security-compliance\.sh/]) assert.match(iacRecipe, re);
  assert.match(complianceSh, /\.security\/vulnerability-register\.yaml/);
  for (const g of ['Makefile', 'docker-compose.yml', '.security/**', 'scripts/security/**']) assert.ok(filters.global.includes(g));
  assert.match(councilRefresh, /packages\/llm-mesh\/src\/generated-model-council\.ts/);

  const ruleCounts = {};
  let directlySelected = 0;
  for (const raw of fixture.historicalRuns) {
    const paths = fixture.pathSets[raw.pathSet];
    const run = { ...raw, paths };
    const jobs = selectedJobs(filters, paths, { eventName: run.event });
    if (run.ai.length > 0) assert.ok(jobs.includes('test-api-unit-integration'), `LLM run ${run.id} selects test-api-unit-integration`);
    for (const job of [...new Set(run.variants.map((v) => v.replace(/#\d+$/, '')))]) {
      if (jobs.includes(job)) { directlySelected += 1; continue; }
      const qualified = qualifyHistoricalExclusion(job, run, filters);
      assert.ok(qualified, `run ${run.id} (${run.event}) has unqualified omission ${job} for paths ${paths.join(',')}`);
      ruleCounts[qualified.rule] = (ruleCounts[qualified.rule] ?? 0) + 1;
      if (qualified.rule === 'toolbox-ui-only') {
        assert.match(String(ci.jobs['security-container'].if), /needs\.build-api-tool-image\.result == 'skipped'/);
        for (const uiJob of ['typecheck-lint-ui', 'build-ui', 'test-e2e', 'e2e-vscode']) {
          assert.ok(!(ci.jobs[uiJob].steps ?? []).map((s) => s.with?.name).includes('api-tool-image'));
        }
      } else if (qualified.rule === 'iac-inputs-untouched') {
        assert.ok(!selectedFilters(filters, paths).includes('global'));
      } else if (qualified.rule === 'idp-sync-inputs-untouched') {
        assert.equal(ci.jobs['validate-idp-sync'].if, "needs.changes.outputs.idp_sync == 'true'");
        assert.ok(!selectedFilters(filters, paths).includes('idp_sync'));
      } else if (qualified.rule === 'push-skips-pr-bump-guard') {
        assert.equal(ci.jobs['enforce-package-bump'].if, "github.event_name == 'pull_request'");
        assert.ok(selectedJobs(filters, paths, { eventName: 'pull_request' }).includes('enforce-package-bump'));
      } else if (qualified.rule === 'resolved-llm-equivalence-council') {
        for (const req of ['validate-llm-mesh', 'validate-llm-gateway', 'validate-cluster-mesh', 'test-api-unit-integration']) assert.ok(jobs.includes(req));
        assert.ok(!selectedFilters(filters, paths).includes(qualified.filterKey));
      }
    }
  }
  assert.ok(directlySelected >= 120, `expected >=120 directly selected historical variants, got ${directlySelected}`);
  assert.equal(ruleCounts['toolbox-ui-only'], 9);
  assert.equal(ruleCounts['push-skips-pr-bump-guard'], 24);
});

test('repair additions are present and Finding 1 consumer closures are enforced', () => {
  for (const [name, globs] of Object.entries(fixture.repairMap)) {
    for (const glob of globs) assert.ok(filters[name].includes(glob), `${name} includes repaired ${glob}`);
  }
  for (const c of fixture.cases) {
    const selected = selectedFilters(filters, c.paths);
    for (const f of c.requiredFilters) assert.ok(selected.includes(f), `${c.id}: filter ${f} selected`);
    const jobs = selectedJobs(filters, c.paths, { eventName: c.event ?? 'pull_request' });
    for (const j of c.requiredJobs) assert.ok(jobs.includes(j), `${c.id}: job ${j} selected`);
    for (const ex of c.excludedJobs ?? []) {
      assert.ok(!jobs.includes(ex.job), `${c.id}: excluded job ${ex.job} is not selected`);
      const q = qualifyHistoricalExclusion(ex.job, { ...c, event: c.event ?? 'pull_request' }, filters);
      assert.equal(q?.rule, ex.rule, `${c.id}: exclusion rule matches for ${ex.job}`);
    }
    if (c.expectation === 'fallback-complete') {
      assert.equal(hasUnresolvedInput(filters, c.paths), true, `${c.id}: triggers unknown-input fallback`);
    }
  }
});

test('strict gate table matches execution predicates for API-only, UI-only, PR bump and missing outputs', () => {
  const allFalse = Object.fromEntries(SELECTION_KEYS.map((k) => [k, 'false']));
  assert.equal(hasValidSelectionOutputs(allFalse), true);
  assert.equal(hasValidSelectionOutputs({ api: 'true' }), false);
  assert.throws(() => requiredSuccessJobs({}), /missing selection outputs/);
  assert.throws(() => requiredSuccessJobs({ api: 'true' }, { requireAllKeys: true }), /incomplete selection outputs/);

  const apiOnly = requiredSuccessJobs({ ...allFalse, api: 'true' }, { eventName: 'pull_request', requireAllKeys: true });
  for (const j of ['enforce-package-bump', 'test-api-unit-integration', 'typecheck-lint-api', 'smoke-idp-screens', 'build-api-image', 'build-ui', 'build-e2e', 'test-e2e', 'e2e-vscode', 'security-sast-sca', 'security-container']) {
    assert.ok(apiOnly.includes(j), `api-only requires ${j}`);
  }
  assert.ok(!apiOnly.includes('typecheck-lint-ui'), 'api-only does not require typecheck-lint-ui');

  const uiOnly = requiredSuccessJobs({ ...allFalse, ui: 'true' }, { eventName: 'pull_request', requireAllKeys: true });
  for (const j of ['enforce-package-bump', 'typecheck-lint-ui', 'build-api-image', 'build-ui', 'build-e2e', 'test-e2e', 'e2e-vscode', 'security-sast-sca', 'security-container']) {
    assert.ok(uiOnly.includes(j), `ui-only requires ${j}`);
  }
  assert.ok(!uiOnly.includes('test-api-unit-integration'), 'ui-only does not require test-api-unit-integration');

  const docsPush = requiredSuccessJobs(allFalse, { eventName: 'push', requireAllKeys: true });
  assert.deepEqual(docsPush, ['changes', 'validate-publishable-manifests']);
  const docsPr = requiredSuccessJobs(allFalse, { eventName: 'pull_request', requireAllKeys: true });
  assert.deepEqual(docsPr, ['changes', 'enforce-package-bump', 'validate-publishable-manifests']);
});

test('glob matcher handles exact, star and double-star entries', () => {
  assert.ok(matchGlob('packages/mcp-auth/**', 'packages/mcp-auth/src/core.ts'));
  assert.ok(matchGlob('package-lock.json', 'package-lock.json'));
  assert.ok(!matchGlob('packages/mcp-auth/**', 'packages/mcp-authx/src/core.ts'));
  assert.ok(!matchGlob('ui/**', 'api/src/app.ts'));
});
