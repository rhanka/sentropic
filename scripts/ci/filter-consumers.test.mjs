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
  JOB_FILTERS,
  matchGlob,
  requiredSuccessJobs,
  selectedFilters,
  selectedJobs,
} from './filter-consumers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const filters = YAML.parse(ci.jobs.changes.steps.find((s) => s.id === 'filter').with.filters);
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'ci', 'fixtures', 'consumer-regressions.json'), 'utf8'),
);

test('history anchors: 74 non-fallback, 181 with fallback, 4 LLM cases', () => {
  assert.equal(fixture.history.nonFallbackOmissions, 74);
  assert.equal(fixture.history.withFallbackOmissions, 181);
  assert.equal(fixture.history.llmCases, 4);
  assert.equal(fixture.cases.filter((c) => c.llm && !c.synthetic).length, 4);
});

test('every omitted variant class is covered by at least one fixture case', () => {
  const covered = new Set(fixture.cases.flatMap((c) => [...(c.requiredJobs ?? []), ...(c.omittedJobs ?? [])]));
  for (const job of Object.keys(fixture.history.nonFallbackByJob)) assert.ok(covered.has(job), `${job} covered`);
  const fallbackCovered = new Set(
    fixture.cases.filter((c) => c.expectation === 'fallback-complete').flatMap((c) => c.omittedJobs ?? []),
  );
  for (const job of Object.keys(fixture.history.fallbackByJob)) {
    const key = job === 'validate-idp-sync' ? 'validate-idp-sync' : job;
    assert.ok(fallbackCovered.has(key), `${job} recorded with the complete requirement`);
  }
});

test('repair additions are present; existing selections are preserved', () => {
  for (const [name, globs] of Object.entries(fixture.repairMap)) {
    for (const glob of globs) assert.ok(filters[name].includes(glob), `${name} includes repaired ${glob}`);
  }
  const preserved = {
    api: ['api/**', 'packages/llm-mesh/**', 'packages/chat-core/**', 'package-lock.json'],
    ui: ['ui/**', 'packages/chat-ui/**', 'packages/cowork-bridge/**'],
    global: ['Makefile', '.github/workflows/ci.yml', 'e2e/**'],
    cluster_mesh: ['packages/cluster-mesh/**'],
    llm_gateway: ['packages/llm-gateway/**', 'packages/llm-mesh/**'],
    manifest_guard: ['scripts/ci/**'],
  };
  for (const [name, globs] of Object.entries(preserved)) {
    for (const glob of globs) assert.ok(filters[name].includes(glob), `${name} keeps ${glob}`);
  }
});

test('repaired cases select every required filter and job', () => {
  for (const c of fixture.cases.filter((c) => c.expectation === 'repaired-selects')) {
    const selected = selectedFilters(filters, c.paths);
    for (const f of c.requiredFilters) assert.ok(selected.includes(f), `${c.id}: ${f} selected`);
    const jobs = selectedJobs(filters, c.paths);
    for (const j of c.requiredJobs ?? []) assert.ok(jobs.includes(j), `${c.id}: ${j} selected`);
    if (c.llm) assert.ok(jobs.includes('test-api-unit-integration'), `${c.id}: affected AI suites selected`);
  }
});

test('exclusions and fallbacks carry an explicit rationale', () => {
  for (const c of fixture.cases.filter((c) => c.expectation === 'qualified-exclusion')) {
    assert.ok((c.excludedJobs ?? []).length > 0 && c.excludedJobs.every((x) => x.rationale.length > 20), c.id);
  }
  for (const c of fixture.cases.filter((c) => c.expectation === 'fallback-complete')) {
    assert.match(c.rationale, /complete suites/, c.id);
    assert.match(c.rationale, /Lot 2/, c.id);
  }
  assert.equal(fixture.cases.filter((c) => c.expectation === 'needs-review').length, 0, 'no unresolved case');
});

test('strict gate table: selected lanes must succeed, unselected lanes may skip', () => {
  const api = requiredSuccessJobs({ api: 'true', global: 'false', ui: 'false' });
  for (const j of ['test-api-unit-integration', 'typecheck-lint-api', 'smoke-idp-screens', 'build-api-image']) {
    assert.ok(api.includes(j), `api-selected ${j} must succeed`);
  }
  assert.ok(!api.includes('typecheck-lint-ui'), 'unselected UI lane may skip');
  const docs = requiredSuccessJobs({ api: 'false', global: 'false', ui: 'false' });
  assert.deepEqual(docs, ['changes', 'validate-publishable-manifests']);
  const global = requiredSuccessJobs({ api: 'false', global: 'true', ui: 'false' });
  assert.ok(global.includes('security-iac') && global.includes('test-e2e'), 'global change needs complete suites');
  assert.ok(!global.includes('validate-idp-sync'), 'idp-sync stays global-free by design');
});

test('glob matcher handles exact, star and double-star entries', () => {
  assert.ok(matchGlob('packages/mcp-auth/**', 'packages/mcp-auth/src/core.ts'));
  assert.ok(matchGlob('package-lock.json', 'package-lock.json'));
  assert.ok(!matchGlob('packages/mcp-auth/**', 'packages/mcp-authx/src/core.ts'));
  assert.ok(!matchGlob('ui/**', 'api/src/app.ts'));
});
