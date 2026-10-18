import { describe, expect, it } from 'vitest';
import { validatePgLayout, quotePgIdentifier } from '../../src/storage/postgres/protocol.js';
import { classifyPgFailure } from '../../src/storage/postgres/errors.js';
import { decodePgBytes, decodePgCounter, decodePgUtf8 } from '../../src/storage/postgres/codec.js';

describe('injected Postgres protocol boundary', () => {
  it('should own safe layout identifiers and refuse request-shaped SQL injection', () => {
    const projectionSchemas = { comments: 'comments_projection' };
    const layout = validatePgLayout({ dataSchema: 'canonical', projectionSchemas, outboxSchema: 'outbox' });
    projectionSchemas.comments = 'changed';
    expect(layout.projectionSchemas.comments).toBe('comments_projection');
    expect(quotePgIdentifier('Mixed_Case')).toBe('"Mixed_Case"');
    for (const dataSchema of ['', 'x; DROP SCHEMA public', 'x.y', 'x"y']) expect(() => validatePgLayout({ ...layout, dataSchema })).toThrow();
  });
  it('should decode exact counters and owned canonical bytes without coercing data loss', () => {
    expect(decodePgCounter('9007199254740993')).toBe('9007199254740993');
    expect(() => decodePgCounter(9007199254740992)).toThrow();
    const bytes = Buffer.from('\uFEFFcanonical-🙂');
    const owned = decodePgBytes(bytes); bytes.fill(0);
    expect(decodePgUtf8(owned)).toBe('\uFEFFcanonical-🙂');
    expect(() => decodePgUtf8(Buffer.from([0xc3, 0x28]))).toThrow();
  });
  it('should classify structured SQL conditions and unknown commit outcomes without message matching', () => {
    expect(classifyPgFailure({ code: '40001' })).toMatchObject({ code: 'unavailable', condition: 'contention', retryable: true });
    expect(classifyPgFailure({ code: '57014' })).toMatchObject({ condition: 'timeout', retryable: false });
    expect(classifyPgFailure({ code: 'ECONNRESET', phase: 'commit' })).toMatchObject({ condition: 'outcome_unknown', retryable: false });
    expect(classifyPgFailure({ code: '23505', constraint: 'known_record' }, { known_record: 'idempotency-conflict' })).toMatchObject({ code: 'idempotency-conflict' });
    expect(classifyPgFailure(new Error('40001 denied'))).toMatchObject({ code: 'unavailable', retryable: false });
  });
});
