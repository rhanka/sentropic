import { describe, expect, it } from 'vitest';
import {
  CLASSIFIER_BETA, DANGEROUS_TOOL_BETA, detectNativeBillingError,
  NATIVE_BILLING_MASKED_MESSAGE, neutralizeFeatureIdentifiers,
  parseNativeErrorDetail, SAFEGUARDS_NOT_SUPPORTED_MESSAGE, sanitizeNativeErrorMessage,
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
    expect(sanitizeNativeErrorMessage('\u0000\u0001\u001F\u007F\u009F')).toBe('invalid request');
  });

  it('preserves non-control whitespace without trimming', () => {
    expect(sanitizeNativeErrorMessage('  max_tokens: invalid value  ')).toBe('  max_tokens: invalid value  ');
    expect(sanitizeNativeErrorMessage('\u0000   \u0001')).toBe('   ');
  });

  it('rejects an upstream error body exceeding the 64 KiB ceiling', () => {
    const large = JSON.stringify({ error: { type: 'invalid_request_error', message: 'x'.repeat(66_000) } });
    expect(() => parseNativeErrorDetail(large, 400)).toThrow(expect.objectContaining({ kind: 'bad-request' }));
  });

  it('rejects invalid JSON, missing error envelope or non-validation errors', () => {
    expect(() => parseNativeErrorDetail('not-json', 400)).toThrow();
    expect(() => parseNativeErrorDetail('{}', 400)).toThrow();
    expect(() => parseNativeErrorDetail(JSON.stringify({ error: { type: 'api_error', message: 'fail' } }), 500)).toThrow();
    expect(() => parseNativeErrorDetail(JSON.stringify({ error: { message: 'invalid field' } }), 400)).toThrow();
    expect(() => parseNativeErrorDetail(JSON.stringify({ error: { type: 123, message: 'invalid field' } }), 400)).toThrow();
    expect(() => parseNativeErrorDetail(JSON.stringify({ error: { type: 'invalid_request_error', message: 123 } }), 400)).toThrow();
    expect(() => parseNativeErrorDetail(JSON.stringify({ error: { type: 'api_error', message: 'invalid field' } }), 400)).toThrow();
  });

  it.each([
    { name: 'absent type', body: { error: { message: 'Your credit balance is too low.' } } },
    { name: 'unknown type', body: { error: { type: 'unknown_type', message: 'Your credit balance is too low.' } } },
    { name: 'non-string type', body: { error: { type: 123, message: 'Your credit balance is too low.' } } },
  ])('masks billing on bounded 400 even with malformed/absent error type: $name', ({ body }) => {
    const detail = parseNativeErrorDetail(JSON.stringify(body), 400);
    expect(detail).toEqual({ type: 'invalid_request_error', message: NATIVE_BILLING_MASKED_MESSAGE });
  });

  it.each([
    'Your organization does not have access to fallback-credit-2026-06-01',
    'fallback-credit-2026-06-01 is unavailable for this model',
    'anthropic-billing-header: invalid value',
    'fallback_credit_token: invalid value',
    'max_tokens: 100000 exceeds model limit 8192',
  ])('relays negative identifier fixture without masking: %s', (message) => {
    expect(detectNativeBillingError(message)).toBe(false);
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400);
    expect(detail).toEqual({ type: 'invalid_request_error', message });
  });

  it.each([
    'Your organization does not have access to fallback-credit-2026-06-01. Your credit balance is too low.',
    'fallback-credit-2026-06-01 is unavailable for this model. Please recharge credits.',
    'anthropic-billing-header: invalid value. Monthly spending cap reached.',
    'fallback_credit_token: invalid value; account funds depleted.',
    'Your credit balance is too low; purchase credits',
    'low credit: please buy credits to continue',
  ])('masks mixed identifier and real billing indicator: %s', (message) => {
    expect(detectNativeBillingError(message)).toBe(true);
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400);
    expect(detail).toEqual({ type: 'invalid_request_error', message: NATIVE_BILLING_MASKED_MESSAGE });
  });

  it('K7: bounds scan work to at most one check per maximal run on 64 KiB adversarial input', () => {
    const noSuffix = 'a-' + 'a-'.repeat(32767);
    expect(noSuffix.length).toBe(65536);
    const statsNoSuffix = { runs: 0, checks: 0, work: 0 };
    expect(neutralizeFeatureIdentifiers(noSuffix, statsNoSuffix)).toBe(noSuffix);
    expect(statsNoSuffix.runs).toBe(1);
    expect(statsNoSuffix.checks).toBe(1);
    expect(statsNoSuffix.work).toBeLessThanOrEqual(noSuffix.length * 2);
    expect(detectNativeBillingError(noSuffix)).toBe(false);

    const validRun = `${'a'.repeat(65525)}-2026-06-01`;
    expect(validRun.length).toBe(65536);
    const statsValid = { runs: 0, checks: 0, work: 0 };
    expect(neutralizeFeatureIdentifiers(validRun, statsValid)).toBe('neutralized-identifier');
    expect(statsValid.runs).toBe(1);
    expect(statsValid.checks).toBe(1);
    expect(statsValid.work).toBeLessThanOrEqual(validRun.length * 2);
    expect(statsValid.work).toBeGreaterThanOrEqual(validRun.length - 12);
    expect(detectNativeBillingError(validRun)).toBe(false);

    expect(detectNativeBillingError(`${validRun} credit balance is low`)).toBe(true);

    const multi = 'anthropic-header-1 fallback-credit-2026-06-01 plain-word-no-date';
    const statsMulti = { runs: 0, checks: 0, work: 0 };
    expect(neutralizeFeatureIdentifiers(multi, statsMulti))
      .toBe('neutralized-identifier neutralized-identifier plain-word-no-date');
    expect(statsMulti.runs).toBe(3);
    expect(statsMulti.checks).toBe(3);
    expect(statsMulti.work).toBeLessThanOrEqual(multi.length * 2);
  });

  it('recognizes shortest valid 12-character feature identifier a-2026-06-01', () => {
    expect(neutralizeFeatureIdentifiers('a-2026-06-01')).toBe('neutralized-identifier');
    expect(detectNativeBillingError('a-2026-06-01')).toBe(false);
  });

  it('respects underscore boundaries: underscores are word characters that prevent sub-identifier split', () => {
    const text = 'prefix_fallback-credit-2026-06-01_suffix fallback_credit_token _anthropic-header';
    const stats = { runs: 0, checks: 0, work: 0 };
    expect(neutralizeFeatureIdentifiers(text, stats)).toBe(text);
    expect(detectNativeBillingError(text)).toBe(false);
  });

  it('rewrites official V-2 unknown-beta error for sent classifier beta when safeguards present', () => {
    const message = `Unexpected value(s) \`${CLASSIFIER_BETA}\` for the \`anthropic-beta\` header. Please consult our documentation at platform.claude.com/docs or try again without the header.`;
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400, { requestSafeguards: true, sentBetas: [CLASSIFIER_BETA] });
    expect(detail).toEqual({
      type: 'invalid_request_error',
      message: SAFEGUARDS_NOT_SUPPORTED_MESSAGE,
    });
  });

  it.each([
    `Unsupported beta: ${CLASSIFIER_BETA}`,
    `Beta not supported: ${CLASSIFIER_BETA}`,
    `Unrecognized beta: ${CLASSIFIER_BETA}`,
    `Unknown beta: ${CLASSIFIER_BETA}`,
    `Invalid beta: ${CLASSIFIER_BETA}`,
    `Unexpected value: ${CLASSIFIER_BETA}`,
  ])('rewrites classifier rejection keyword: %s', (message) => {
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400, { requestSafeguards: true, sentBetas: ['other-header', CLASSIFIER_BETA] });
    expect(detail).toEqual({
      type: 'invalid_request_error',
      message: SAFEGUARDS_NOT_SUPPORTED_MESSAGE,
    });
  });

  it.each([
    `Unsupported beta: ${DANGEROUS_TOOL_BETA}`,
    `Unexpected value(s) \`${DANGEROUS_TOOL_BETA}\` for the \`anthropic-beta\` header. Please consult our documentation at platform.claude.com/docs or try again without the header.`,
  ])('preserves dangerous-tool-use rejection verbatim for client memory: %s', (message) => {
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400, { requestSafeguards: true, sentBetas: [CLASSIFIER_BETA, DANGEROUS_TOOL_BETA] });
    expect(detail).toEqual({ type: 'invalid_request_error', message });
  });

  it.each([
    'messages.0.content.0.safeguards: invalid value',
    `Unsupported beta: ${CLASSIFIER_BETA}; safeguards validation failed`,
  ])('preserves messages containing safeguards word verbatim: %s', (message) => {
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400, { requestSafeguards: true, sentBetas: [CLASSIFIER_BETA] });
    expect(detail).toEqual({ type: 'invalid_request_error', message });
  });

  it.each([
    `Unexpected value(s) \`auto-mode-classifier-2026-07-16-extra\` for the \`anthropic-beta\` header. Please consult our documentation at platform.claude.com/docs or try again without the header.`,
    `Unexpected value(s) \`prefix-auto-mode-classifier-2026-07-16\` for the \`anthropic-beta\` header. Please consult our documentation at platform.claude.com/docs or try again without the header.`,
    `Unsupported beta: auto-mode-classifier-2026-07-16-extra`,
  ])('preserves classifier token prefix/suffix variations verbatim: %s', (message) => {
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400, { requestSafeguards: true, sentBetas: [CLASSIFIER_BETA, 'auto-mode-classifier-2026-07-16-extra'] });
    expect(detail).toEqual({ type: 'invalid_request_error', message });
  });

  it.each([
    `Unsupported beta: ${CLASSIFIER_BETA}`,
    `Unexpected value(s) \`${CLASSIFIER_BETA}\` for the \`anthropic-beta\` header. Please consult our documentation at platform.claude.com/docs or try again without the header.`,
  ])('preserves classifier rejection verbatim if classifier beta was not sent: %s', (message) => {
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400, { requestSafeguards: true, sentBetas: ['message-threads-2026-08-12'] });
    expect(detail).toEqual({ type: 'invalid_request_error', message });
  });

  it.each([
    `Unsupported beta: ${CLASSIFIER_BETA}`,
    `Unexpected value(s) \`${CLASSIFIER_BETA}\` for the \`anthropic-beta\` header. Please consult our documentation at platform.claude.com/docs or try again without the header.`,
  ])('preserves classifier rejection verbatim if request does not own safeguards: %s', (message) => {
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400, { requestSafeguards: false, sentBetas: [CLASSIFIER_BETA] });
    expect(detail).toEqual({ type: 'invalid_request_error', message });
  });

  it.each([
    'Unsupported beta: message-threads-2026-08-12',
    'Unexpected value(s) `message-threads-2026-08-12` for the `anthropic-beta` header. Please consult our documentation at platform.claude.com/docs or try again without the header.',
  ])('preserves unrelated beta rejection verbatim even when request owns safeguards: %s', (message) => {
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400, { requestSafeguards: true, sentBetas: [CLASSIFIER_BETA, 'message-threads-2026-08-12'] });
    expect(detail).toEqual({ type: 'invalid_request_error', message });
  });

  it('prioritizes billing masking over safeguards rewrite when both present', () => {
    const message = `Unexpected value(s) \`${CLASSIFIER_BETA}\` for the \`anthropic-beta\` header. Account credit balance is low.`;
    const detail = parseNativeErrorDetail(JSON.stringify({
      error: { type: 'invalid_request_error', message },
    }), 400, { requestSafeguards: true, sentBetas: [CLASSIFIER_BETA] });
    expect(detail).toEqual({
      type: 'invalid_request_error',
      message: NATIVE_BILLING_MASKED_MESSAGE,
    });
  });
});

