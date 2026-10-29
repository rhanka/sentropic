import { canonicalizeJson, sha256Hex } from './schema-validator.mjs';
import { isCommitSha, isSha256Hex } from './receipt.mjs';
import { readCandidateInput, writeImmutable } from './candidate.mjs';

export function normalizeReportPath(path) {
  const text = String(path).replaceAll('\\', '/');
  const match = /(?:^|\/)((?:packages|tools)\/.*)$/.exec(text);
  if (!match || match[1].split('/').some(p => p === '..' || p === '.')) throw Error('proof: invalid report path');
  return match[1];
}

/** Preserve actual assertion names/statuses. Missing assertions never become passes. */
export function bundleProof(catalog, inputs, binding) {
  if (!isCommitSha(binding.sourceHead) || !isSha256Hex(binding.artifactManifestSha256) ||
      typeof binding.command !== 'string' || typeof binding.runId !== 'string' || !Number.isInteger(binding.attempt)) {
    throw Error('proof: exact execution binding required');
  }
  const failures = [], rows = [], seen = new Set(), origins = [];
  for (const input of inputs) {
    const report = JSON.parse(input.bytes);
    if (report.success !== true) failures.push(`proof: ${input.path} execution did not succeed`);
    origins.push({ path: input.path, sha256: sha256Hex(input.bytes) });
    for (const key of ['sourceHead', 'artifactManifestSha256', 'runId', 'attempt']) {
      if (report[key] !== binding[key]) failures.push(`proof: ${input.path} ${key} mismatch or absent`);
    }
    if (catalog.requiresE4 && report.executionMode !== 'installed-candidate') failures.push(`proof: ${input.path} is not installed E4 evidence`);
    if (!Array.isArray(report.testResults)) { failures.push(`proof: ${input.path} lacks testResults`); continue; }
    for (const result of report.testResults) {
      const file = normalizeReportPath(result.name);
      if (!catalog.files.includes(file)) continue;
      if (seen.has(file)) { failures.push(`proof: duplicate executed file ${file}`); continue; }
      seen.add(file); rows.push({ ...result, name: file });
      if (result.status !== 'passed' || !result.assertionResults?.length) failures.push(`proof: failed/empty file ${file}`);
      for (const id of catalog.fileCases[file]) {
        if (!result.assertionResults?.some(a => a.status === 'passed' && String(a.fullName || a.title).includes(id))) {
          failures.push(`proof: missing executed case ${id} in ${file}`);
        }
      }
    }
  }
  for (const file of catalog.files) if (!seen.has(file)) failures.push(`proof: missing executed file ${file}`);
  const assertions = rows.flatMap(r => r.assertionResults || []);
  const count = state => assertions.filter(a => a.status === state).length;
  const passed = count('passed'), failed = count('failed'), todo = count('todo');
  const skipped = assertions.length - passed - failed - todo;
  if (failed || skipped || todo) failures.push('proof: failed/skipped/todo assertions');
  const executed = rows.flatMap(r => (r.assertionResults || []).filter(a => a.status === 'passed')
    .map(a => ({ file: r.name, caseId: a.fullName || a.title, status: 'passed' })));
  const report = { ...binding, success: failures.length === 0, numTotalTests: assertions.length,
    numPassedTests: passed, numFailedTests: failed, numPendingTests: skipped, numTodoTests: todo,
    testResults: rows, inputReports: origins };
  return { report, failures, result: { format: 'vitest-json', passed, failed, skipped, todo,
    executedCasesSha256: sha256Hex(Buffer.from(canonicalizeJson(executed))) } };
}

export function retainProofBundle(root, directory, catalog, reportPaths, binding) {
  const inputs = reportPaths.map(path => ({ path, bytes: readCandidateInput(root, path) }));
  const proofs = [], failures = [];
  for (const row of catalog.proofs) {
    const actual = bundleProof(row, inputs, binding);
    const ref = writeImmutable(root, `${directory}/${row.id}.json`, actual.report);
    proofs.push({ id: row.id, files: row.files, command: binding.command,
      sourceHead: binding.sourceHead, artifactManifestSha256: binding.artifactManifestSha256,
      runId: binding.runId, attempt: binding.attempt, result: { ...actual.result, ...ref } });
    failures.push(...actual.failures.map(message => `${row.id}: ${message}`));
  }
  return { proofs, failures };
}
