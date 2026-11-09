import { describe, expect, it } from 'vitest';
import {
  RECIPE_TAIL_BYTES, classifyRecipeFailure, readRecipeDiagnostics, scrubRecipeOutput, truncateRecipeTail,
} from '../../../src/services/artifacts/live/recipe-diagnostics';

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');
const result = (overrides: Record<string, unknown> = {}) =>
  ({ exitCode: 1, signal: null, output: b64('npm error boom'), ...overrides });

describe('recipe diagnostics', () => {
  it('should scrub auth tokens, authorization headers and URLs with userinfo, idempotently', () => {
    const dirty = '//registry.npmjs.org/:_authToken=secret-1\n'
      + 'Authorization: Bearer secret-2\n'
      + 'fetch https://user:pass@registry.npmjs.org/vite/-/vite-1.0.0.tgz\n'
      + 'npm error code E1\n';
    const scrubbed = scrubRecipeOutput(dirty);
    expect(scrubbed).toBe('//registry.npmjs.org/:_authToken=[redacted]\n'
      + 'Authorization: [redacted]\n'
      + 'fetch https://[redacted]@registry.npmjs.org/vite/-/vite-1.0.0.tgz\n'
      + 'npm error code E1\n');
    expect(scrubbed).not.toContain('secret-1'); expect(scrubbed).not.toContain('secret-2');
    expect(scrubbed).not.toContain('user:pass');
    expect(scrubRecipeOutput(scrubbed)).toBe(scrubbed);
  });

  it('should leave plain registry URLs and scoped package paths alone', () => {
    const plain = 'fetch https://registry.npmjs.org/vite/-/vite-1.0.0.tgz\nfetch https://registry.npmjs.org/@scope%2fpkg\n';
    expect(scrubRecipeOutput(plain)).toBe(plain);
  });

  it('should bound the tail to the last bytes without splitting a multibyte sequence', () => {
    expect(truncateRecipeTail('abc', 4096)).toBe('abc');
    const long = `${'x'.repeat(5000)}tail`;
    expect(truncateRecipeTail(long)).toBe(long.slice(-RECIPE_TAIL_BYTES));
    expect(Buffer.byteLength(truncateRecipeTail(long))).toBeLessThanOrEqual(RECIPE_TAIL_BYTES);
    const emoji = `head-${'é'.repeat(3000)}-tail`;
    const truncated = truncateRecipeTail(emoji, 100);
    expect(Buffer.byteLength(truncated)).toBeLessThanOrEqual(100);
    expect(truncated.endsWith('-tail')).toBe(true);
    expect(() => Buffer.from(truncated, 'utf8').toString('utf8')).not.toThrow();
  });

  it('should classify ENOSPC from the code or the kernel message', () => {
    expect(classifyRecipeFailure({ exitCode: 1, signal: null, output: 'npm error code ENOSPC' })).toBe('enospc');
    expect(classifyRecipeFailure({ exitCode: 1, signal: null, output: 'write error: no space left on device' })).toBe('enospc');
  });

  it('should classify a missing cached tarball as enotcached', () => {
    for (const output of ['npm error code ENOTCACHED',
      "cache mode is 'only-if-cached' but no cached response is available",
      'tarball not in cache, offline install refused']) {
      expect(classifyRecipeFailure({ exitCode: 1, signal: null, output })).toBe('enotcached');
    }
  });

  it('should classify exit 137, SIGKILL and heap markers as oom', () => {
    expect(classifyRecipeFailure({ exitCode: 137, signal: null, output: '' })).toBe('oom');
    expect(classifyRecipeFailure({ exitCode: null, signal: 'SIGKILL', output: '' })).toBe('oom');
    expect(classifyRecipeFailure({ exitCode: 134, signal: 'SIGABRT', output: 'FATAL ERROR: JavaScript heap out of memory' }))
      .toBe('oom');
  });

  it('should carry other signals and plain exits verbatim, unknown last', () => {
    expect(classifyRecipeFailure({ exitCode: null, signal: 'SIGTERM', output: '' })).toBe('signal_SIGTERM');
    expect(classifyRecipeFailure({ exitCode: 1, signal: null, output: 'npm error code EAI_AGAIN' })).toBe('exit_1');
    expect(classifyRecipeFailure({ exitCode: null, signal: null, output: '' })).toBe('exit_unknown');
  });

  it('should prefer the tail cause over the signal or exit marker', () => {
    expect(classifyRecipeFailure({ exitCode: 137, signal: 'SIGKILL', output: 'npm error code ENOSPC' })).toBe('enospc');
    expect(classifyRecipeFailure({ exitCode: 137, signal: null, output: 'no cached response is available' })).toBe('enotcached');
  });

  it('should accept the exact pod shape and return the decoded scrubbed bounded tail', () => {
    const read = readRecipeDiagnostics({ exitCode: 1, signal: null, output: b64('npm error _authToken=secret-x\nboom') });
    expect(read).toEqual({ exitCode: 1, signal: null, output: 'npm error _authToken=[redacted]\nboom' });
  });

  it('should bound and scrub a long pod tail', () => {
    const read = readRecipeDiagnostics({ exitCode: 1, signal: null,
      output: b64(`${'y'.repeat(9000)}Authorization: Bearer secret-y`) });
    expect(read).toBeDefined();
    expect(Buffer.byteLength(read!.output)).toBeLessThanOrEqual(RECIPE_TAIL_BYTES);
    expect(read!.output).not.toContain('secret-y');
    expect(read!.output.endsWith('Authorization: [redacted]')).toBe(true);
  });

  it('should refuse a malformed pod reply instead of guessing', () => {
    for (const data of [undefined, null, 42, 'x', {}, { exitCode: '1', signal: null, output: '' },
      { exitCode: 1, signal: 'sig term', output: '' }, { exitCode: 1, signal: null, output: '!!!not-base64!!!' },
      { exitCode: 1, signal: null, output: 'x'.repeat(9000) }, { exitCode: 1.5, signal: null, output: '' }]) {
      expect(readRecipeDiagnostics(data)).toBeUndefined();
    }
  });
});
