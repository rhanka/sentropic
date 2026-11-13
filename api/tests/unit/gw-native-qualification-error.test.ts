import { describe, expect, it } from 'vitest';
import { qualificationFailure } from '../ai/gw-native-qualification-error';

describe('qualification diagnostics', () => {
  it('should retain known readiness evidence through nested wrappers', () => {
    const cause = new Error('Qualification prerequisite failed: operator UAT mode is not armed');
    const inner = qualificationFailure('construction', cause);
    expect(qualificationFailure('readiness', inner).message).toBe(`readiness: construction: ${cause.message}`);
    expect(qualificationFailure('readiness', Object.assign(new Error('private filename'), { code: 'ENOENT' })).message)
      .toBe('readiness: ENOENT');
  });

  it('should suppress credentials, payloads, paths, unknown codes and nested raw causes', () => {
    for (const cause of [new Error('Bearer secret-token https://user:password@host/private'),
      new SyntaxError('private JSON payload'), new TypeError('private URL'),
      Object.assign(new Error('private'), { code: 'secret-code' }),
      new Error('private', { cause: new Error('private nested credential') }), 'private']) {
      const error = qualificationFailure('readiness', cause);
      expect(error.message).not.toMatch(/private|secret|password/);
      expect(error.cause).toBeUndefined();
      expect(error.stack).not.toContain('secret-token');
    }
  });
});
