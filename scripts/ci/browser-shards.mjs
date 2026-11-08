import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Mean of the summed per-file test durations (seconds) over main runs 42421623485 and
// 42408187255, attempt 1. Missing files retain null measured duration; balancing weight is not a receipt.
export const baselineDurations = {
  "tests/00-access-control.spec.ts": 19,
  "tests/00-ai-generation.spec.ts": 22.4,
  "tests/01-admin-users.spec.ts": 9,
  "tests/01-app.spec.ts": 10.1,
  "tests/01-organizations-detail.spec.ts": 42.2,
  "tests/02-auth-devices.spec.ts": 4.9,
  "tests/02-auth-oauth-authorization-code.spec.ts": 1.5,
  "tests/02-auth-oauth-revoke.spec.ts": 2.6,
  "tests/02-auth-oauth-wellknown.spec.ts": 0.1,
  "tests/02-auth-routes.spec.ts": 2.9,
  "tests/02-auth-s2s-client-credentials.spec.ts": 0.4,
  "tests/02-auth-simple.spec.ts": 12.1,
  "tests/02-auth-webauthn.spec.ts": 9.4,
  "tests/02-auth-workflow.spec.ts": 23.6,
  "tests/02-organizations.spec.ts": 20.6,
  "tests/03-chat-chrome-extension-auth.spec.ts": 2.3,
  "tests/03-chat-chrome-extension.spec.ts": 6.2,
  "tests/03-chat-mobile-docked-nav.spec.ts": 26.9,
  "tests/03-chat.spec.ts": 49,
  "tests/03-dashboard.spec.ts": 39,
  "tests/03-prioritization-matrix.spec.ts": 15.5,
  "tests/04-chat-image-paste.spec.ts": 7.2,
  "tests/04-documents-ui-actions.spec.ts": 6.6,
  "tests/04-dossiers-reload-draft.spec.ts": 3.4,
  "tests/04-google-drive-composer.spec.ts": 6.9,
  "tests/04-google-drive-settings-documents.spec.ts": 8.2,
  "tests/04-tenancy-workspaces.spec.ts": 17.4,
  "tests/05-error-handling.spec.ts": 6.3,
  "tests/05-executive-summary.spec.ts": 3.1,
  "tests/05-folder-new-multi-org.spec.ts": 4.9,
  "tests/05-folders.spec.ts": 11.7,
  "tests/05-i18n.spec.ts": 10.5,
  "tests/05-usecase-detail.spec.ts": 34.6,
  "tests/06-settings-codex-provider.spec.ts": 7.3,
  "tests/06-settings.spec.ts": 26.3,
  "tests/06-streams.spec.ts": 4.7,
  "tests/06-tooling-visual-parity.spec.ts": 5.1,
  "tests/06-usecase.spec.ts": 7.4,
  "tests/07-import-export.spec.ts": 4.6,
  "tests/07-matrix.spec.ts": 17.2,
  "tests/07-workflow.spec.ts": 6.7,
  "tests/07_comment_assistant.spec.ts": 4.9,
  "tests/08-chat-checkpoint-restore.spec.ts": 3,
  "tests/08-chat-context-chips.spec.ts": 3.2,
  "tests/08-chat-heavy.spec.ts": 3,
  "tests/08-chat-workspace-switch.spec.ts": 4.7,
  "tests/08-document-summary-formats.spec.ts": 1.6,
  "tests/08-documents-summary.spec.ts": 1.6,
  "tests/08-pptx-org-generation.spec.ts": 5.6,
  "tests/08-xlsx-multisheet-query.spec.ts": 1.4,
  "tests/09-chat-freeze-terminal.spec.ts": 3.9,
  "tests/09-chat-multitool-demo.spec.ts": 12.3,
  "tests/09-chat-org-update-tool.spec.ts": 5.1,
  "tests/09-run-steering-core.spec.ts": 2.7,
  "tests/09-todo-runtime-panel-actions.spec.ts": 1.9,
  "tests/10-cluster-mesh-control-plane.spec.ts": 0.2
};
export const baselineRuns = [42421623485, 42408187255];
export const baselineJobs = [128552902172, 128552902221, 128552902326, 128552902427, 128552902369, 128552902249,
  128511892514, 128511892617, 128511892471, 128511892508, 128511892449, 128511892494];
export function browserFiles() {
  const dir = existsSync('e2e/tests') ? 'e2e/tests' : 'tests';
  return readdirSync(dir).filter(f => /^\d\d[-_].*\.spec\.ts$/.test(f)).map(f => `tests/${f}`).sort();
}

export function buildManifest(files = browserFiles(), durations = baselineDurations, count = 6) {
  if (!Number.isInteger(count) || count < 1 || new Set(files).size !== files.length || !files.length) throw new Error('Invalid shard inventory');
  const shards = Array.from({ length: count }, (_, i) => ({ id: i + 1, project: 'chromium', files: [],
    measuredTestSeconds: 0, unmeasured: [], balancingWeight: 0 }));
  const weight = file => durations[file] ?? 1;
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const shard = [...shards].sort((a, b) => a.balancingWeight - b.balancingWeight || a.id - b.id)[0];
    shard.files.push(file);
    shard.balancingWeight += weight(file);
    if (durations[file] == null) shard.unmeasured.push(file);
    else shard.measuredTestSeconds += durations[file];
  }
  return { version: 1, baseline: { runs: baselineRuns, attempt: 1, jobs: baselineJobs },
    expectedFiles: [...files].sort(), shards };
}

export function testIdentities(report) {
  const identities = [];
  const visit = (suite, parents = []) => {
    const titles = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      identities.push({ id: `${test.projectName}:${spec.file}:${spec.line}:${spec.column}:${JSON.stringify([...titles, spec.title])}`,
        expectedStatus: test.expectedStatus, results: test.results ?? [] });
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return identities;
}

// Snapshot collected tests before hooks can mark them skipped at runtime.
export function expectedFromSuite(config, suite) {
  const serialize = (node, projectName) => ({ title: node.title,
    specs: node.tests.map(test => ({ title: test.title,
      file: relative(config.rootDir, test.location.file).split(sep).join('/'),
      line: test.location.line, column: test.location.column,
      tests: [{ projectName, expectedStatus: test.expectedStatus, results: [] }] })),
    suites: node.suites.map(child => serialize(child, projectName)) });
  return { suites: suite.suites.flatMap(project =>
    project.suites.map(file => serialize(file, project.project().name))) };
}

export default class BrowserMembershipReporter {
  printsToStdio() { return false; }
  onBegin(config, suite) {
    const file = process.env.CI_BROWSER_EXPECTED_FILE;
    if (!file) throw new Error('Missing expected browser membership output');
    writeFileSync(file, JSON.stringify(expectedFromSuite(config, suite), null, 2));
  }
}

export function reconcileReports(expected, actual) {
  const before = testIdentities(expected), after = testIdentities(actual);
  const expectedById = new Map(before.map(row => [row.id, row]));
  const unique = rows => new Set(rows.map(row => row.id));
  if (!before.length || unique(before).size !== before.length || unique(after).size !== after.length
    || before.length !== after.length || before.some(row => !unique(after).has(row.id))) throw new Error('Incomplete or duplicate browser membership');
  const failures = after.filter(row => row.expectedStatus !== expectedById.get(row.id)?.expectedStatus
    || !row.results.length || row.results.some(r =>
    r.status !== (row.expectedStatus === 'skipped' ? 'skipped' : row.expectedStatus)));
  if (failures.length || actual.errors?.length) throw new Error('Browser failures, cancellations or retries remain visible');
  return { expected: before.length, executed: after.filter(row => row.expectedStatus !== 'skipped').length,
    declaredSkipped: after.filter(row => row.expectedStatus === 'skipped').length,
    retries: after.reduce((sum, row) => sum + Math.max(0, row.results.length - 1), 0) };
}

export function validateMatrix(workflow, manifest = buildManifest()) {
  const section = workflow.match(/^  test-e2e:\n([\s\S]*?)(?=^  [\w-]+:)/m)?.[1] ?? '';
  const selected = [...section.matchAll(/^\s+(?:- )?shard: (\d+)\s*$/gm)].map(m => Number(m[1]));
  if (selected.length !== manifest.shards.length || new Set(selected).size !== selected.length
    || manifest.shards.some(shard => !selected.includes(shard.id))) throw new Error('CI shard matrix differs from complete inventory');
  return manifest.expectedFiles.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'files') {
    const shard = buildManifest().shards.find(row => row.id === Number(args[0]));
    if (!shard?.files.length) throw new Error('Unknown or empty browser shard');
    console.log(shard.files.join(' '));
  } else if (command === 'reconcile') console.log(JSON.stringify(reconcileReports(...args.map(file => JSON.parse(readFileSync(file, 'utf8'))))));
  else if (command === 'inventory') console.log(`Complete browser inventory: ${validateMatrix(readFileSync('.github/workflows/ci.yml', 'utf8'))} files`);
  else console.log(JSON.stringify(buildManifest(), null, 2));
}
