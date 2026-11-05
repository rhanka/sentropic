import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Sum of observed successful test durations, main run 41277623779, attempt 1.
// Missing files retain null measured duration; balancing weight is not a receipt.
export const baselineDurations = {
  "tests/03-chat-chrome-extension.spec.ts": 8.4,
  "tests/03-chat-chrome-extension-auth.spec.ts": 2.3,
  "tests/03-chat-mobile-docked-nav.spec.ts": 24.6,
  "tests/03-dashboard.spec.ts": 31.7,
  "tests/03-chat.spec.ts": 96.997,
  "tests/03-prioritization-matrix.spec.ts": 10.5,
  "tests/08-chat-checkpoint-restore.spec.ts": 4.5,
  "tests/08-chat-context-chips.spec.ts": 5,
  "tests/08-chat-workspace-switch.spec.ts": 6.5,
  "tests/08-chat-heavy.spec.ts": 7.4,
  "tests/08-xlsx-multisheet-query.spec.ts": 5,
  "tests/08-pptx-org-generation.spec.ts": 7.5,
  "tests/08-document-summary-formats.spec.ts": 6.8,
  "tests/08-documents-summary.spec.ts": 18.9,
  "tests/09-run-steering-core.spec.ts": 5.592,
  "tests/09-todo-runtime-panel-actions.spec.ts": 3,
  "tests/09-chat-freeze-terminal.spec.ts": 11.2,
  "tests/09-chat-org-update-tool.spec.ts": 9.3,
  "tests/09-chat-multitool-demo.spec.ts": 28.5,
  "tests/05-error-handling.spec.ts": 7.8,
  "tests/05-executive-summary.spec.ts": 5,
  "tests/05-folder-new-multi-org.spec.ts": 4.8,
  "tests/05-folders.spec.ts": 13.4,
  "tests/05-i18n.spec.ts": 22.9,
  "tests/05-usecase-detail.spec.ts": 24.897,
  "tests/07_comment_assistant.spec.ts": 6.6,
  "tests/07-import-export.spec.ts": 7,
  "tests/07-matrix.spec.ts": 32.4,
  "tests/07-workflow.spec.ts": 9,
  "tests/00-access-control.spec.ts": 14.996,
  "tests/00-ai-generation.spec.ts": 80.9,
  "tests/02-auth-devices.spec.ts": 4,
  "tests/02-auth-oauth-wellknown.spec.ts": 0.14,
  "tests/02-auth-oauth-authorization-code.spec.ts": 2.1,
  "tests/02-auth-routes.spec.ts": 2.923,
  "tests/02-auth-s2s-client-credentials.spec.ts": 0.128,
  "tests/02-auth-oauth-revoke.spec.ts": 1.9,
  "tests/02-auth-simple.spec.ts": 9.031,
  "tests/02-auth-webauthn.spec.ts": 11.706,
  "tests/02-auth-workflow.spec.ts": 19.515,
  "tests/02-organizations.spec.ts": 12.574,
  "tests/06-settings.spec.ts": 28.291,
  "tests/06-settings-codex-provider.spec.ts": 9.3,
  "tests/06-streams.spec.ts": 8.147,
  "tests/06-usecase.spec.ts": 4.003,
  "tests/06-tooling-visual-parity.spec.ts": 3.6,
  "tests/10-cluster-mesh-control-plane.spec.ts": 0.126,
  "tests/01-app.spec.ts": 6.687,
  "tests/01-admin-users.spec.ts": 7.7,
  "tests/01-organizations-detail.spec.ts": 25.823,
  "tests/04-chat-image-paste.spec.ts": 8,
  "tests/04-dossiers-reload-draft.spec.ts": 4,
  "tests/04-google-drive-composer.spec.ts": 5.4,
  "tests/04-google-drive-settings-documents.spec.ts": 5.2,
  "tests/04-tenancy-workspaces.spec.ts": 14.397,
  "tests/04-documents-ui-actions.spec.ts": 13.895
};
export const baselineJobs = [124763781719, 124763781722, 124763781735, 124763781744, 124763781873];
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
  return { version: 1, baseline: { run: 41277623779, attempt: 1, jobs: baselineJobs },
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
