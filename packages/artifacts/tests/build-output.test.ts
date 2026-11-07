import { describe, expect, it } from 'vitest';
import { validateBuildOutput, type BuildOutputEntry } from '../src/server/build-output.js';
import { ArtifactOperationError, classifyArtifactFailure } from '../src/server/failures.js';

// A-LIVE §8.3 / §10 lot 2 boundary fixtures: 255/256 files, 16 MiB±1 per file, 64 MiB±1 in total.
const MiB = 1024 * 1024;
const file = (path: string, bytes = 1): BuildOutputEntry => ({ path, kind: 'file', bytes });
const files = (count: number, bytes = 1) => [file('index.html', bytes),
  ...Array.from({ length: count - 1 }, (_, i) => file(`assets/chunk-${i}.js`, bytes))];
function refusal(entries: unknown, code: string, options?: Parameters<typeof validateBuildOutput>[1]) {
  let failure: unknown;
  try { validateBuildOutput(entries as BuildOutputEntry[], options); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ArtifactOperationError);
  expect(failure).toMatchObject({ kind: code });
  expect(classifyArtifactFailure(failure, {
    invocationId: 'output', operation: 'build', phase: 'output', commitState: 'not_committed',
  })).toMatchObject({ publicCode: code, httpStatus: 422, commitState: 'not_committed', retriable: false });
}

describe('GB1 candidate output ceilings', () => {
  it('should admit 255 files and refuse 256 as dist_over_limits', () => {
    expect(validateBuildOutput(files(255), { entry: 'index.html' })).toHaveLength(255);
    refusal(files(256), 'dist_over_limits');
  });

  it('should admit a 16 MiB file and refuse 16 MiB + 1', () => {
    expect(validateBuildOutput([file('index.html', 16 * MiB)])).toEqual([
      { path: 'index.html', bytes: 16 * MiB, mimeType: 'text/html' }]);
    refusal([file('index.html', 16 * MiB + 1)], 'dist_over_limits');
  });

  it('should admit 64 MiB in total and refuse 64 MiB + 1', () => {
    const full = files(4, 16 * MiB);
    expect(validateBuildOutput(full).reduce((sum, entry) => sum + entry.bytes, 0)).toBe(64 * MiB);
    refusal([...full, file('assets/extra.css', 1)], 'dist_over_limits');
  });

  it('should apply a stricter profile and refuse limits above the server ceiling', () => {
    refusal(files(3), 'dist_over_limits', { limits: { maxFiles: 2 } });
    refusal([file('index.html', 11)], 'dist_over_limits', { limits: { maxFileBytes: 10 } });
    expect(() => validateBuildOutput(files(1), { limits: { maxFiles: 256 } })).toThrow('above the server maxima');
  });

  it('should refuse links, special files, escapes, duplicates, unmapped types and a missing entry', () => {
    for (const entries of [[], [{ path: 'index.html', kind: 'symlink', bytes: 1 }], [{ path: 'dev', kind: 'other', bytes: 0 }],
      [file('../index.html')], [file('/index.html')], [file('a//index.html')], [file('a\\b.js')], [file('a%2e.js')],
      [file('index.html'), file('index.html')], [file('robots.txt')], [file('index')], [file('index.html', -1)],
      [file('index.html', 1.5)], [null]]) {
      refusal(entries, 'verification_failed');
    }
    refusal([file('assets/app.js')], 'verification_failed', { entry: 'index.html' });
  });

  it('should return the admitted inventory in canonical order with server-derived MIME types', () => {
    expect(validateBuildOutput([file('index.html', 3), file('assets/app.js', 2)], { entry: 'index.html' })).toEqual([
      { path: 'assets/app.js', bytes: 2, mimeType: 'text/javascript' },
      { path: 'index.html', bytes: 3, mimeType: 'text/html' }]);
  });
});
