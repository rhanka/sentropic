import { describe, expect, it } from 'vitest';
import {
  detectNativeBillingError, NATIVE_BILLING_MASKED_MESSAGE, parseNativeErrorDetail,
  sanitizeNativeErrorMessage,
} from '../src/native-errors.js';

describe('native error billing classifier and bounding', () => {
  it.each([
    'billing issue detected', 'payment required for account', 'invoice overdue', 'invoicing error',
    'credit balance is zero', 'credit card declined', 'insufficient credits available',
    'prepaid credit exhausted', 'please top-up credits to continue', 'recharge your account credits',
    'credits are depleted', 'credit balance is negative', 'out of credits', 'run out of credit',
    'no credits remaining', 'spending limit exceeded', 'monthly spending cap reached',
    'organization balance is zero', 'account funds depleted',
  ])('detects positive billing family: %s', (phrase) => {
    expect(detectNativeBillingError(`Upstream error: ${phrase}`)).toBe(true);
  });

  it('detects billing indicators split or spaced by C0/C1 controls', () => {
    expect(detectNativeBillingError('c\u0000r\u0001e\u0002d\u001Fi\u0080t\u009F balance is zero')).toBe(true);
    expect(detectNativeBillingError('purchase\u0000credits now')).toBe(true);
    expect(detectNativeBillingError('account\u001Ffunds exhausted')).toBe(true);
  });

  it('detects late billing indicators beyond the 4096-byte public truncation limit', () => {
    const padding = 'x'.repeat(4500);
    const message = `${padding} and your credit balance is zero`;
    expect(detectNativeBillingError(message)).toBe(true);
    const parsed = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400);
    expect(parsed.message).toBe(NATIVE_BILLING_MASKED_MESSAGE);
  });

  it('truncates public message at 4096 UTF-8 bytes preserving multibyte code point boundaries', () => {
    const euro = '€'; // 3 UTF-8 bytes
    const base = euro.repeat(1365); // 4095 bytes
    const text = `${base}€ extra`;
    const sanitized = sanitizeNativeErrorMessage(text);
    const bytes = new TextEncoder().encode(sanitized);
    expect(bytes.length).toBe(4095);
    expect(sanitized).toBe(base);

    const emoji = '🚀'; // 4 UTF-8 bytes
    const emojiBase = emoji.repeat(1024); // 4096 bytes
    expect(new TextEncoder().encode(sanitizeNativeErrorMessage(`${emojiBase}🚀`)).length).toBe(4096);
  });

  it('returns fixed invalid request fallback when sanitized message is empty', () => {
    expect(sanitizeNativeErrorMessage('\u0000\u0001\u001F\u007F\u009F   ')).toBe('invalid request');
  });

  it('rejects an upstream error body exceeding the 64 KiB ceiling', () => {
    const large = JSON.stringify({ error: { type: 'invalid_request_error', message: 'x'.repeat(66_000) } });
    expect(() => parseNativeErrorDetail(large, 400)).toThrow(expect.objectContaining({ kind: 'bad-request' }));
  });

  it('rejects invalid JSON, missing error envelope or non-validation errors', () => {
    expect(() => parseNativeErrorDetail('not-json', 400)).toThrow();
    expect(() => parseNativeErrorDetail('{}', 400)).toThrow();
    expect(() => parseNativeErrorDetail(JSON.stringify({ error: { type: 'api_error', message: 'fail' } }), 500)).toThrow();
  });
});
