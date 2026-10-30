import { describe, expect, it } from 'vitest';
import {
  classifyStateless,
  IngressRefusal,
  validateClassified,
  validateVectorFreshness,
} from '../../src/services/canvas-live/ingress';

describe('canvas live ingress classification', () => {
  it('should refuse reserved meta writes whole', () => {
    const classified = classifyStateless(['meta'], ['body'], { metaWrites: ['schemaEpoch'] });
    expect(() => validateClassified(classified, ['body'])).toThrow('reserved-meta');
  });

  it('should refuse a field outside the admitted set', () => {
    const classified = classifyStateless(['field:other'], ['body']);
    expect(() => validateClassified(classified, ['body'])).toThrow('foreign-field');
  });

  it('should refuse non-host writes to field metadata maps', () => {
    const classified = classifyStateless(['fieldmeta:body'], ['body']);
    expect(() => validateClassified(classified, ['body'])).toThrow('foreign-meta');
  });

  it('should refuse unsupported marks whole including a valid insert in the same update', () => {
    const classified = classifyStateless(['field:body'], ['body'], {
      marks: [{ name: 'underline', value: true }],
    });
    expect(() => validateClassified(classified, ['body'])).toThrow('unsupported-mark');
    const badValue = classifyStateless(['field:body'], ['body'], {
      marks: [{ name: 'bold', value: 'thick' }],
    });
    expect(() => validateClassified(badValue, ['body'])).toThrow('unsupported-mark');
  });

  it('should accept valid concurrent formatting across separator and hard-break embeds', () => {
    const classified = classifyStateless(['field:body'], ['body'], {
      marks: [{ name: 'bold', value: true }],
      embeds: [{ kind: 'separator', payload: { paragraphId: 'p-2' } }],
    });
    expect(() => validateClassified(classified, ['body'])).not.toThrow();
    const hardBreak = classifyStateless(['field:body'], ['body'], {
      embeds: [{ kind: 'hard-break', payload: {} }],
    });
    expect(() => validateClassified(hardBreak, ['body'])).not.toThrow();
  });

  it('should refuse unsupported embeds, invalid separators, duplicates and first-separator deletes', () => {
    expect(() =>
      validateClassified(classifyStateless(['field:body'], ['body'], { embeds: [{ kind: 'image', payload: {} }] }), ['body']),
    ).toThrow('unsupported-embed');
    expect(() =>
      validateClassified(classifyStateless(['field:body'], ['body'], { embeds: [{ kind: 'separator', payload: {} }] }), ['body']),
    ).toThrow('invalid-separator');
    expect(() =>
      validateClassified(classifyStateless(['field:body'], ['body'], { paragraphIds: ['p-1', 'p-1'] }), ['body']),
    ).toThrow('duplicate-paragraph');
    expect(() =>
      validateClassified(classifyStateless(['field:body'], ['body'], { deletedSeparators: ['first'] }), ['body']),
    ).toThrow('first-separator-delete');
  });

  it('should refuse a stale state-vector candidate', () => {
    expect(() => validateVectorFreshness('vec-a', 'vec-a')).toThrow(IngressRefusal);
  });
});
