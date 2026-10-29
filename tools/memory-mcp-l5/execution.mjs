import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCandidateInput, writeImmutable } from './candidate.mjs';
import { sha256 } from './precandidate.mjs';

const contextPath = 'spec/evidence/memory-mcp-l5/r5-run/execution-context.json';

export function createExecutionContext(root, manifestPath, sourceHead) {
  const bytes = readCandidateInput(root, manifestPath), manifest = JSON.parse(bytes);
  if (!/^[a-f0-9]{40}$/.test(sourceHead) || manifest.stage !== 'candidate' || manifest.source.l5Head !== sourceHead) {
    throw Error('execution: source/candidate binding mismatch');
  }
  const binding = { sourceHead, artifactManifestSha256: sha256(bytes),
    command: `make memory-l5-qualify ARTIFACT_MANIFEST=${manifestPath} CHECKPOINT=${process.env.CHECKPOINT || 'spec/evidence/memory-mcp-l5/r5-checkpoint.json'} API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-memory-l5`,
    runId: process.env.GITHUB_RUN_ID || `local-${Date.now()}`, attempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1) };
  if (!Number.isInteger(binding.attempt) || binding.attempt < 1) throw Error('execution: positive attempt required');
  writeImmutable(root, contextPath, { binding, manifestPath, provenance: 'local execution binding; CI authentication is separate' });
  return binding;
}

/** Bind results at execution, retaining raw bytes and actual names/statuses. */
export function executeProof({ root, output, executable, args, cwd, executionMode }) {
  const context = resolve(root, contextPath);
  if (!existsSync(context)) return spawnSync(executable, [...args, '--reporter=json', `--outputFile=${output}`], { cwd, stdio: 'inherit' });
  const { binding, manifestPath } = JSON.parse(readCandidateInput(root, contextPath));
  const manifestBytes = readCandidateInput(root, manifestPath);
  if (sha256(manifestBytes) !== binding.artifactManifestSha256 || JSON.parse(manifestBytes).source.l5Head !== binding.sourceHead) {
    throw Error('execution: manifest changed after context creation');
  }
  const path = resolve(root, output), rawPath = path + '.raw.json';
  if (!path.startsWith(resolve(root) + '/') || existsSync(path) || existsSync(rawPath)) throw Error('execution: unsafe or existing report output');
  writeImmutable(root, output + '.binding.json', { ...binding, executionMode });
  const run = spawnSync(executable, [...args, '--reporter=json', `--outputFile=${rawPath}`], { cwd, stdio: 'inherit' });
  if (!existsSync(rawPath)) throw Error(`execution: process produced no JSON report (exit ${run.status})`);
  const raw = readFileSync(rawPath), report = JSON.parse(raw);
  writeFileSync(path, JSON.stringify({ ...report, ...binding, executionMode,
    success: report.success === true && run.status === 0 && !run.error,
    processExit: run.status, rawReport: { path: rawPath.slice(resolve(root).length + 1), sha256: sha256(raw) } }) + '\n', { flag: 'wx' });
  return run;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), value = key => argv.includes(key) ? argv[argv.indexOf(key) + 1] : undefined;
  try {
    if (argv[0] === 'context') createExecutionContext(process.cwd(), process.env.ARTIFACT_MANIFEST, process.env.MEMORY_L5_SOURCE_HEAD);
    else {
      if (!['--output', '--mode', '--program'].every(key => argv.includes(key)) || !argv.includes('--')) throw Error('execution: output/mode/program and test arguments required');
      const run = executeProof({ root: value('--root') || process.cwd(), output: value('--output'),
        executable: process.execPath, args: [value('--program'), ...argv.slice(argv.indexOf('--') + 1)],
        cwd: process.cwd(), executionMode: value('--mode') });
      process.exitCode = run.status ?? 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
