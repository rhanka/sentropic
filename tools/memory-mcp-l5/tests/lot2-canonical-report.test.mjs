import { expect, it } from 'vitest';
import { checkLot2CanonicalReport } from '../lot2-canonical-report.mjs';
// Synthetic report metadata is a validator fixture, never retained acceptance evidence.
it('should refuse source-only results and cross-tuple canonical reports', () => {
  const binding = { phase: 'e2', artifactManifestSha256: 'a'.repeat(64), e2ArtifactSha256: 'b'.repeat(64),
    referenceArtifactSha256: 'c'.repeat(64), sourceHead: 'd'.repeat(40) };
  const report = { success: true, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [{ assertionResults: [{ status: 'passed', fullName: 'P05.broker.sqlite-workflow-store-wal-full' }] }] };
  const errors = checkLot2CanonicalReport(binding, report, binding);
  expect(errors.join('\n')).toContain('canonical-fenced-store');
  expect(errors.join('\n')).toContain('after-commit-before-workflow-completion');
  expect(checkLot2CanonicalReport({ ...binding, artifactManifestSha256: '0'.repeat(64) }, report, binding))
    .toContain('canonical report: tuple binding mismatch');
  expect(checkLot2CanonicalReport(binding, { ...report, numPendingTests: 1 }, binding))
    .toContain('canonical report: failed/skipped/todo or incomplete results');
});
it('should recognize complete metadata without treating it as checkpoint acceptance', () => {
  const binding = { phase: 'e2', artifactManifestSha256: 'a'.repeat(64), e2ArtifactSha256: 'b'.repeat(64),
    referenceArtifactSha256: 'c'.repeat(64), sourceHead: 'd'.repeat(40) };
  const ids = ['P05.e2.canonical-fenced-store', 'P06.e2.before-claim', 'P06.e2.before-canonical-commit',
    'P06.e2.after-commit-before-workflow-completion', 'P06.e2.after-completion-before-response'];
  const report = { success: true, numPassedTests: 5, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [{ assertionResults: ids.map(id => ({ status: 'passed', fullName: id + ': synthetic metadata fixture' })) }] };
  expect(checkLot2CanonicalReport(binding, report, binding)).toEqual([]);
  expect(checkLot2CanonicalReport(binding, { ...report, testResults: [null] }, binding).length).toBeGreaterThan(0);
});
