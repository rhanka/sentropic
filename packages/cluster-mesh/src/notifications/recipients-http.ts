// Product pull RecipientsPort (conductor contract v1, notify L1).
//
// The platform maps `sentropic.io/target=<productKey>` to a platform-declared
// {productKey, recipientsUrl, serviceClientAudience} triple; the host calls
// `GET <recipientsUrl>?target=<productKey>` with a service-client bearer and
// the product answers 200:
//   { v: 1, target: "<productKey>", asOf: "<ISO>", admins: [
//       { accountRef: "<product-local stable id>",
//         email: "<address>",
//         basis: ["workspace:manage_members" | "app:is_admin", ...] }, ... ] }
// An empty list is a configuration alert, never silence. Answers cache
// 10 min, stale-while-error 24 h. Pure except the injected fetch/clock.

import { normalizeOpsRecipientEmail, type OpsAlertRecipientV1 } from './recipients.js';
import {
  OPS_JOB_FAILURE_OCCURRED_AT_PATTERN,
  OPS_JOB_FAILURE_RECIPIENT_BASES_V1,
} from './ops-job-failure-types.js';

export const OPS_PRODUCT_RECIPIENTS_TIMEOUT_MS = 3000;
export const OPS_PRODUCT_RECIPIENTS_CACHE_TTL_MS = 10 * 60 * 1000;
export const OPS_PRODUCT_RECIPIENTS_STALE_MS = 24 * 60 * 60 * 1000;

export type OpsProductRecipientsFailureCode =
  | 'timeout'
  | 'network'
  | 'bad_status'
  | 'invalid_json'
  | 'not_an_object'
  | 'bad_version'
  | 'target_mismatch'
  | 'bad_as_of'
  | 'future_response'
  | 'stale_response'
  | 'bad_admins';

export class OpsProductRecipientsError extends Error {
  constructor(
    readonly code: OpsProductRecipientsFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'OpsProductRecipientsError';
  }
}

export interface OpsProductAdminEntryV1 {
  readonly accountRef: string;
  readonly email: string;
  readonly basis: readonly string[];
}

export interface OpsValidatedProductRecipientsV1 {
  readonly target: string;
  readonly asOf: string;
  readonly recipients: readonly OpsAlertRecipientV1[];
  readonly skipped: readonly { readonly accountRef: string; readonly reason: string }[];
}

const NO_CONTROLS_PATTERN = /^[^\u0000-\u001f\u007f]*$/u;

function isCleanRef(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && NO_CONTROLS_PATTERN.test(value);
}

/**
 * Validate one product answer. Whole-payload faults (version, target echo,
 * `asOf`) reject; invalid admin entries are skipped with reasons so one bad
 * entry cannot silence the whole target. Empty admins is valid: the caller
 * raises the configuration alert.
 */
export function validateOpsProductRecipientsPayload(
  input: unknown,
  expectedTarget: string,
  nowIso: string,
): OpsValidatedProductRecipientsV1 {
  const reject = (code: OpsProductRecipientsFailureCode, message: string): never => {
    throw new OpsProductRecipientsError(code, message);
  };
  if (typeof input !== 'object' || input === null) reject('not_an_object', 'product recipients answer must be an object');
  const answer = input as Record<string, unknown>;
  if (answer['v'] !== 1) reject('bad_version', 'product recipients answer v must be 1');
  if (answer['target'] !== expectedTarget) reject('target_mismatch', 'product recipients answer targets another product');
  const asOf = answer['asOf'];
  if (typeof asOf !== 'string' || !OPS_JOB_FAILURE_OCCURRED_AT_PATTERN.test(asOf) || Number.isNaN(Date.parse(asOf))) {
    reject('bad_as_of', 'product recipients answer asOf must be UTC ISO-8601');
  }
  const now = Date.parse(nowIso);
  const at = Date.parse(asOf as string);
  if (at - now > 5 * 60 * 1000) reject('future_response', 'product recipients answer is from the future');
  if (now - at > OPS_PRODUCT_RECIPIENTS_STALE_MS) reject('stale_response', 'product recipients answer is older than 24 h');
  if (!Array.isArray(answer['admins'])) reject('bad_admins', 'product recipients answer admins must be an array');
  const recipients: OpsAlertRecipientV1[] = [];
  const skipped: { accountRef: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const entry of answer['admins'] as unknown[]) {
    const accountRef = (entry as Record<string, unknown>)?.['accountRef'];
    if (!isCleanRef(accountRef)) {
      skipped.push({ accountRef: String((entry as Record<string, unknown>)?.['accountRef'] ?? ''), reason: 'bad_account_ref' });
      continue;
    }
    const basis = (entry as Record<string, unknown>)['basis'];
    const allowed = new Set<string>(OPS_JOB_FAILURE_RECIPIENT_BASES_V1);
    const bases = Array.isArray(basis) ? basis.filter((b): b is string => typeof b === 'string' && allowed.has(b)) : [];
    if (bases.length === 0) {
      skipped.push({ accountRef, reason: 'bad_basis' });
      continue;
    }
    const email = normalizeOpsRecipientEmail((entry as Record<string, unknown>)['email']);
    if (email === null) {
      skipped.push({ accountRef, reason: 'invalid_email' });
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    recipients.push({ accountId: accountRef, email, basis: bases.join('+') });
  }
  return { target: expectedTarget, asOf: asOf as string, recipients, skipped };
}

export interface OpsMinimalResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type OpsFetchLike = (url: string, init: { signal?: AbortSignal }) => Promise<OpsMinimalResponse>;

export interface OpsFetchProductRecipientsInput {
  readonly url: string;
  readonly targetKey: string;
  readonly fetchFn: OpsFetchLike;
  readonly timeoutMs?: number;
  readonly nowIso: string;
}

/** GET the product answer with a bounded timeout, then validate it. */
export async function fetchOpsProductRecipients(
  input: OpsFetchProductRecipientsInput,
): Promise<OpsValidatedProductRecipientsV1> {
  const timeoutMs = input.timeoutMs ?? OPS_PRODUCT_RECIPIENTS_TIMEOUT_MS;
  const url = `${input.url}?target=${encodeURIComponent(input.targetKey)}`;
  let response: OpsMinimalResponse;
  try {
    response = await input.fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new OpsProductRecipientsError('timeout', `product recipients fetch timed out after ${timeoutMs} ms`);
    }
    throw new OpsProductRecipientsError('network', 'product recipients fetch failed');
  }
  if (!response.ok) {
    throw new OpsProductRecipientsError('bad_status', `product recipients answered HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OpsProductRecipientsError('invalid_json', 'product recipients answer is not JSON');
  }
  return validateOpsProductRecipientsPayload(payload, input.targetKey, input.nowIso);
}

export interface OpsCachedProductRecipientsInput {
  /** Fresh fetch, e.g. `fetchOpsProductRecipients` bound to the target URL. */
  readonly load: (targetKey: string) => Promise<OpsValidatedProductRecipientsV1>;
  readonly now?: () => string;
  readonly ttlMs?: number;
  readonly staleMs?: number;
  readonly onError?: (info: { targetKey: string; code: string }) => void;
}

/**
 * Cache wrapper: fresh answers serve for `ttlMs` (default 10 min); a failed
 * refresh serves the stale answer up to `staleMs` (default 24 h) and only
 * then throws, so a product outage degrades to visibly-stale recipients
 * instead of silent drops.
 */
export function createCachedOpsRecipientsPort(
  input: OpsCachedProductRecipientsInput,
): import('./recipients.js').OpsAlertRecipientsPortV1 {
  const now = input.now ?? (() => new Date().toISOString());
  const ttlMs = input.ttlMs ?? OPS_PRODUCT_RECIPIENTS_CACHE_TTL_MS;
  const staleMs = input.staleMs ?? OPS_PRODUCT_RECIPIENTS_STALE_MS;
  const cache = new Map<string, { atMs: number; recipients: readonly import('./recipients.js').OpsAlertRecipientV1[] }>();
  return {
    async listRecipientsForTarget(targetKey: string) {
      const nowMs = Date.parse(now());
      const cached = cache.get(targetKey);
      if (cached && nowMs - cached.atMs <= ttlMs) return cached.recipients;
      try {
        const fresh = await input.load(targetKey);
        cache.set(targetKey, { atMs: Date.parse(fresh.asOf), recipients: fresh.recipients });
        return fresh.recipients;
      } catch (error) {
        const code = error instanceof OpsProductRecipientsError ? error.code : 'network';
        input.onError?.({ targetKey, code });
        if (cached && nowMs - cached.atMs <= staleMs) return cached.recipients;
        throw error;
      }
    },
  };
}
