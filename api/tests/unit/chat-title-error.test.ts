import { describe, expect, it } from 'vitest';
import { titleErrorMetadata } from '../../src/services/llm-runtime/title-error';

describe('title failure warning metadata', () => {
  it('should retain safe SDK status, code and parameter without provider text', () => {
    const secret = 'sensitive-sentinel-never-log';
    const metadata = titleErrorMetadata({ status: 400, code: 'unsupported_parameter',
      param: 'max_tokens', message: secret, headers: { authorization: secret },
      error: { message: secret } });
    expect(metadata).toEqual({ provider: 'openai', model: 'gpt-5.4-nano',
      status: 400, code: 'unsupported_parameter', param: 'max_tokens' });
    expect(JSON.stringify(metadata)).not.toContain(secret);
  });

  it('should retain allowlisted nested errors and redact arbitrary fields', () => {
    expect(titleErrorMetadata({ status: 400, error: { code: 'unsupported_value', param: 'model' } }))
      .toMatchObject({ status: 400, code: 'unsupported_value', param: 'model' });
    for (const error of [null, 'sensitive-sentinel', { status: Infinity,
      code: 'sensitive-sentinel', param: 'sensitive-sentinel' }]) {
      expect(titleErrorMetadata(error)).toMatchObject({ status: null, code: 'unknown', param: 'unknown' });
    }
  });
});
