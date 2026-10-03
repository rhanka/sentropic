import { GatewayError, type NativeValidationPublicDetail } from './router/errors.js';

export const NATIVE_BILLING_MASK_RULE = 'native-billing-mask-v2-2026-10-03';
export const NATIVE_BILLING_MASKED_MESSAGE = 'The upstream service could not accept this request.';
export const NATIVE_MAX_ERROR_BODY_BYTES = 65_536; // 64 KiB
export const NATIVE_MAX_PUBLIC_MESSAGE_BYTES = 4096;
export const CLASSIFIER_BETA = 'auto-mode-classifier-2026-07-16';
export const DANGEROUS_TOOL_BETA = 'dangerous-tool-use-2026-09-03';
export const SAFEGUARDS_NOT_SUPPORTED_MESSAGE =
  'safeguards is not supported by this gateway route; retry without safeguards.';
const CLASSIFIER_REWRITE_PATTERN =
  /\b(?:unsupported|not supported|unrecognized|unknown beta|invalid beta)\b|unexpected value/i;
const CLASSIFIER_EXACT_TOKEN_REGEX =
  /(?<![a-zA-Z0-9_-])auto-mode-classifier-2026-07-16(?![a-zA-Z0-9_-])/i;
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

const isFeatureIdentifier = (run: string, stats?: IdentifierScanStats): boolean => {
  if (run.startsWith('anthropic-') && run.length > 10) {
    if (stats) stats.work += 10;
    return true;
  }
  if (run.length >= 12 && run.charCodeAt(0) >= 97 && run.charCodeAt(0) <= 122) {
    if (stats) stats.work += 12;
    if (DATE_SUFFIX.test(run.slice(-11))) {
      const prefix = run.slice(0, -11);
      for (let i = 0; i < prefix.length; i++) {
        if (stats) stats.work++;
        const c = prefix.charCodeAt(i);
        const isAlphanumeric = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
        if (c === 45 /* '-' */) {
          if (i === 0 || i === prefix.length - 1 || prefix.charCodeAt(i + 1) === 45) {
            return false;
          }
        } else if (!isAlphanumeric) {
          return false;
        }
      }
      return true;
    }
  }
  return false;
};

export interface IdentifierScanStats { runs: number; checks: number; work: number; }

export const neutralizeFeatureIdentifiers = (text: string, stats?: IdentifierScanStats): string => {
  const parts: string[] = []; let lastIndex = 0;
  const runRegex = /[a-z0-9-]+/g; let match: RegExpExecArray | null;
  while ((match = runRegex.exec(text)) !== null) {
    if (stats) stats.runs++;
    const start = match.index; const end = start + match[0].length;
    const prevChar = start > 0 ? text[start - 1] : ''; const nextChar = end < text.length ? text[end] : '';
    if ((!prevChar || !ASCII_WORD.test(prevChar)) && (!nextChar || !ASCII_WORD.test(nextChar))) {
      if (stats) stats.checks++;
      if (isFeatureIdentifier(match[0], stats)) {
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
  if (stripped.length === 0) return 'invalid request';
  const encoder = new TextEncoder();
  if (encoder.encode(stripped).length <= NATIVE_MAX_PUBLIC_MESSAGE_BYTES) return stripped;
  let byteCount = 0; let result = '';
  for (const char of stripped) {
    const charBytes = encoder.encode(char).length;
    if (byteCount + charBytes > NATIVE_MAX_PUBLIC_MESSAGE_BYTES) break;
    byteCount += charBytes; result += char;
  }
  return result || 'invalid request';
};

const processedValidationDetails = new WeakSet<object>();
// Only the complete parser policy may authorize these exact immutable values.
const processedResult = (type: string, message: string): NativeValidationPublicDetail => {
  const detail = Object.freeze({ type, message });
  processedValidationDetails.add(detail);
  return detail;
};

export const isProcessedNativeValidationDetail = (detail: unknown): boolean =>
  !!detail && typeof detail === 'object' && processedValidationDetails.has(detail);

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

  const rawMessage = errorObj && typeof errorObj === 'object' && typeof (errorObj as { message?: unknown }).message === 'string'
    ? (errorObj as { message: string }).message
    : undefined;
  if (status === 400 && rawMessage !== undefined && detectNativeBillingError(rawMessage)) {
    return processedResult('invalid_request_error', NATIVE_BILLING_MASKED_MESSAGE);
  }

  if (!errorObj || typeof errorObj !== 'object' || typeof errorObj.type !== 'string' || typeof errorObj.message !== 'string') {
    throw new GatewayError('bad-request', 'invalid native error structure');
  }
  if (status === 400 && errorObj.type === 'invalid_request_error') {
    const lowerMsg = errorObj.message.toLowerCase();
    const hasNestedOrDangerous = lowerMsg.includes(DANGEROUS_TOOL_BETA) || lowerMsg.includes('safeguards');
    const sentClassifier = Boolean(
      options?.requestSafeguards &&
      options?.sentBetas?.some((b) => b.split(',').map((x) => x.trim()).includes(CLASSIFIER_BETA)),
    );
    const hasClassifierReject = CLASSIFIER_EXACT_TOKEN_REGEX.test(errorObj.message) && CLASSIFIER_REWRITE_PATTERN.test(errorObj.message);
    if (sentClassifier && !hasNestedOrDangerous && hasClassifierReject) {
      return processedResult('invalid_request_error', SAFEGUARDS_NOT_SUPPORTED_MESSAGE);
    }
    return processedResult('invalid_request_error', sanitizeNativeErrorMessage(errorObj.message));
  }
  throw new GatewayError('bad-request', 'non-validation native error status or type');
};
