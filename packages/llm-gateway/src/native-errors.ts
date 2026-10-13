import { GatewayError, type NativeValidationPublicDetail } from './router/errors.js';

export const NATIVE_BILLING_MASK_RULE = 'native-billing-mask-v2-2026-10-03';
export const NATIVE_BILLING_MASKED_MESSAGE = 'The upstream service could not accept this request.';
export const NATIVE_MAX_ERROR_BODY_BYTES = 65_536; // 64 KiB
export const NATIVE_MAX_PUBLIC_MESSAGE_BYTES = 4096;
const NEUTRALIZED_PLACEHOLDER = 'neutralized-identifier';

const BILLING_PATTERNS: readonly RegExp[] = [
  /\b(?:billing|payment|invoice|invoicing)\b/, /\bcredit\s+(?:balance|card)\b/,
  /\b(?:prepaid|purchased|remaining|available|insufficient|exhausted|low)\s+credits?\b/,
  /\b(?:purchase|buy|add|recharge|top[ -]?up)\b.{0,64}?\bcredits?\b/,
  /\b(?:credits?|credit balance)\b.{0,64}?\b(?:low|insufficient|exhausted|depleted|negative|zero|empty|unavailable)\b/,
  /\b(?:out of|run out of|no)\s+credits?\b/, /\b(?:spend|spending|monthly spending)\s+(?:limit|cap|budget)\b/,
  /\b(?:organization|organisation|account)\b.{0,64}?\b(?:balance|funds|credits?)\b/,
];

const DATE_SUFFIX = /^-\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
const ASCII_WORD = /[a-zA-Z0-9_]/;

const isFeatureIdentifier = (run: string): boolean => {
  if (run.startsWith('anthropic-') && run.length > 10) return true;
  if (run.length >= 13 && run.charCodeAt(0) >= 97 && run.charCodeAt(0) <= 122 && DATE_SUFFIX.test(run.slice(-11))) {
    const prefix = run.slice(0, -11);
    return !prefix.includes('--') && !prefix.endsWith('-');
  }
  return false;
};

export interface IdentifierScanStats { runs: number; checks: number; }

export const neutralizeFeatureIdentifiers = (text: string, stats?: IdentifierScanStats): string => {
  const parts: string[] = []; let lastIndex = 0;
  const runRegex = /[a-z0-9-]+/g; let match: RegExpExecArray | null;
  while ((match = runRegex.exec(text)) !== null) {
    if (stats) stats.runs++;
    const start = match.index; const end = start + match[0].length;
    const prevChar = start > 0 ? text[start - 1] : ''; const nextChar = end < text.length ? text[end] : '';
    if ((!prevChar || !ASCII_WORD.test(prevChar)) && (!nextChar || !ASCII_WORD.test(nextChar))) {
      if (stats) stats.checks++;
      if (isFeatureIdentifier(match[0])) {
        parts.push(text.slice(lastIndex, start), NEUTRALIZED_PLACEHOLDER);
        lastIndex = end;
      }
    }
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.join('');
};

export const detectNativeBillingError = (message: string, stats?: IdentifierScanStats): boolean => {
  const norm = message.normalize('NFKC').toLowerCase();
  const v1 = norm.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  const v2 = norm.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  for (const view of [v1, v2]) {
    const neutralized = neutralizeFeatureIdentifiers(view, stats);
    for (const pattern of BILLING_PATTERNS) if (pattern.test(neutralized)) return true;
  }
  return false;
};

export const sanitizeNativeErrorMessage = (message: string): string => {
  const stripped = message.replace(CONTROL_CHARS, '');
  const encoder = new TextEncoder();
  if (encoder.encode(stripped).length <= NATIVE_MAX_PUBLIC_MESSAGE_BYTES) return stripped.trim() || 'invalid request';
  let byteCount = 0; let result = '';
  for (const char of stripped) {
    const charBytes = encoder.encode(char).length;
    if (byteCount + charBytes > NATIVE_MAX_PUBLIC_MESSAGE_BYTES) break;
    byteCount += charBytes; result += char;
  }
  return result.trim() || 'invalid request';
};

export const parseNativeErrorDetail = (
  rawBody: string | Uint8Array, status: number,
  options?: { readonly requestSafeguards?: boolean; readonly sentBetas?: readonly string[] },
): NativeValidationPublicDetail => {
  const text = typeof rawBody === 'string' ? rawBody : new TextDecoder('utf-8').decode(rawBody);
  if (new TextEncoder().encode(text).length > NATIVE_MAX_ERROR_BODY_BYTES) {
    throw new GatewayError('bad-request', 'native error body exceeds 64 KiB ceiling');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new GatewayError('bad-request', 'invalid native error JSON'); }
  const errorObj = parsed && typeof parsed === 'object' && 'error' in parsed
    ? (parsed as { error?: { type?: unknown; message?: unknown } }).error : undefined;
  if (!errorObj || typeof errorObj.type !== 'string' || typeof errorObj.message !== 'string') {
    throw new GatewayError('bad-request', 'invalid native error structure');
  }
  if (status === 400 && errorObj.type === 'invalid_request_error') {
    if (detectNativeBillingError(errorObj.message)) {
      return { type: 'invalid_request_error', message: NATIVE_BILLING_MASKED_MESSAGE };
    }
    return { type: 'invalid_request_error', message: sanitizeNativeErrorMessage(errorObj.message) };
  }
  throw new GatewayError('bad-request', 'non-validation native error status or type');
};
