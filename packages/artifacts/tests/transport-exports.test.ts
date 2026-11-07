import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('should resolve public host subpaths from the built package export map', () => {
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const commit = await import('@sentropic/artifacts/server/commit-contract');
    const outcome = await import('@sentropic/artifacts/server/outcome-contract');
    const testing = await import('@sentropic/artifacts/testing');
    const mime = await import('@sentropic/artifacts/server/mime');
    if (commit.COMMIT_PROTOCOL_VERSION !== 'artifacts-commit/v1' ||
      typeof commit.createArtifactCommitCoordinator !== 'function' ||
      typeof outcome.projectArtifactHttpOutcome !== 'function' ||
      typeof testing.createArtifactCommitBarrier !== 'function' ||
      mime.mimeTypeForPath('report.pdf') !== mime.EXTENSION_TO_MIME['.pdf']) process.exit(1);
    console.log('PUBLIC_HOST_EXPORTS_OK');
  `], { encoding: 'utf8' });
  expect(result.trim()).toBe('PUBLIC_HOST_EXPORTS_OK');
});
