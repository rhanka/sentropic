import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'tmp/l8d/receipt.json';
const bytes = readFileSync(file);
const receipt = JSON.parse(bytes);
const suites = receipt.suites.map((suite) => {
  const files = suite.report.testResults.filter((test) => test.name.endsWith(`/${suite.path}`));
  const cases = files.flatMap((test) => test.assertionResults);
  const groups = new Map();
  for (const item of cases.filter((test) => test.status !== 'passed')) {
    const message = (item.failureMessages ?? []).join('\n');
    const diagnostic = message.replace(/\u001b\[[0-9;]*m/g, '');
    const key = diagnostic.split('\n').slice(0, 4).join('\n');
    const group = groups.get(key) ?? { diagnostic: diagnostic.slice(0, 6000), cases: [] };
    group.cases.push({ title: item.fullName, status: item.status });
    groups.set(key, group);
  }
  return { path: suite.path, sourceSha256: suite.sourceSha256, counts: suite.counts,
    exitCode: suite.exitCode, logSha256: suite.logSha256, failures: [...groups.values()],
    setupErrors: files.filter((test) => test.message).map((test) => test.message) };
});
const summary = { sourceCommit: receipt.sourceCommit, candidate: receipt.candidate,
  tuple: receipt.tuple, tupleDigest: receipt.tupleDigest, radarPins: receipt.radarPins,
  install: { status: receipt.install.status, lockSha256: receipt.install.lockSha256 },
  smoke: { status: receipt.smoke.status, lockSha256: receipt.smoke.lockSha256 },
  receiptSha256: createHash('sha256').update(bytes).digest('hex'), suites,
  imageSmoke: receipt.imageSmoke, shards: receipt.shards };
writeFileSync('tmp/l8d/summary.json', JSON.stringify(summary, null, 2) + '\n');
const classify = (diagnostic) => {
  if (diagnostic.includes('[not covered]')) return 'not covered';
  if (/createPostgresCommitExecutor|injectPhaseFault|invalid compiled artifacts profile/.test(diagnostic)) return 'radar';
  throw new Error(`unclassified failure: ${diagnostic}`);
};
const failures = suites.flatMap((suite) => suite.failures.flatMap((group) => group.cases.map((item) => ({
  suite: suite.path, ...item,
  classification: classify(group.diagnostic || suite.setupErrors.join('\n')),
  diagnostic: (group.diagnostic || suite.setupErrors.join('\n')).split('\n')[0],
}))));
const host = JSON.parse(readFileSync('tmp/l8d/results/host.json'));
for (const file of host.testResults) for (const item of file.assertionResults.filter((test) => test.status === 'failed')) {
  const diagnostic = item.failureMessages.join('\n');
  failures.push({ suite: file.name.split('/radar/')[1], title: item.fullName,
    status: item.status, classification: classify(diagnostic), diagnostic: diagnostic.split('\n')[0] });
}
const evidence = { sourceCommit: summary.sourceCommit, candidateSourceCommit: receipt.candidate.sourceCommit,
  tuple: summary.tuple, tupleDigest: summary.tupleDigest, radarPins: summary.radarPins,
  install: summary.install, smoke: summary.smoke, receiptSha256: summary.receiptSha256,
  suites: suites.map(({ failures, setupErrors, ...suite }) => suite),
  hostCounts: { passed: host.numPassedTests, failed: host.numFailedTests, skipped: host.numPendingTests },
  imageSmoke: summary.imageSmoke, shards: summary.shards };
writeFileSync('tmp/l8d/final-evidence.json', '{\n' + Object.entries(evidence)
  .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('\n') +
  '\n  "failures": [\n' + failures.map((item) => '    ' + JSON.stringify(item)).join(',\n') + '\n  ]\n}\n');
console.log(JSON.stringify(summary, null, 2));
