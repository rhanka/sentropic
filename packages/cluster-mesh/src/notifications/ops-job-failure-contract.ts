// Validation for the frozen OpsJobFailureV1 ingestion payload (notify L1). Pure: no clock, no I/O
// (the caller passes `nowIso` when it wants the freshness window enforced).

import {
  OPS_JOB_FAILURE_CONTRACT_V1,
  OPS_JOB_FAILURE_DETAIL_MAX_BYTES,
  OPS_JOB_FAILURE_EVENT_ID_MAX_LENGTH,
  OPS_JOB_FAILURE_LINK_MAX_LENGTH,
  OPS_JOB_FAILURE_NAME_MAX_LENGTH,
  OPS_JOB_FAILURE_OCCURRED_AT_MAX_AGE_MS,
  OPS_JOB_FAILURE_OCCURRED_AT_MAX_SKEW_MS,
  OPS_JOB_FAILURE_OCCURRED_AT_PATTERN,
  OPS_JOB_FAILURE_TARGET_KEY_MAX_LENGTH,
  opsCanonicalRunKey,
  opsIncidentKey,
  truncateOpsDetail,
  type OpsJobFailureV1,
  type OpsJobKindV1,
  type OpsJobFailureOutcomeV1,
  type OpsJobFailureReasonV1,
  type OpsJobFailureSeverityV1,
} from './ops-job-failure-types.js';

export {
  OPS_JOB_FAILURE_CONTRACT_V1,
  OPS_JOB_FAILURE_DETAIL_MAX_BYTES,
  OPS_JOB_FAILURE_EVENT_ID_MAX_LENGTH,
  OPS_JOB_FAILURE_LINK_MAX_LENGTH,
  OPS_JOB_FAILURE_NAME_MAX_LENGTH,
  OPS_JOB_FAILURE_OCCURRED_AT_MAX_AGE_MS,
  OPS_JOB_FAILURE_OCCURRED_AT_MAX_SKEW_MS,
  OPS_JOB_FAILURE_OCCURRED_AT_PATTERN,
  OPS_JOB_FAILURE_TARGET_KEY_MAX_LENGTH,
  opsCanonicalRunKey,
  opsIncidentKey,
  truncateOpsDetail,
};

const TARGET_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
/** No `/`, no control characters, no leading/trailing whitespace. */
const JOB_REF_SEGMENT_PATTERN = /^[^\s/][^/\u0000-\u001f\u007f]{0,251}[^/\s\u0000-\u001f\u007f]$/u;
const SINGLE_CHAR_SEGMENT_PATTERN = /^[^\s/\u0000-\u001f\u007f]$/u;
/** No control characters in opaque string fields (eventId, runId). */
const NO_CONTROLS_PATTERN = /^[^\u0000-\u001f\u007f]*$/u;

const OUTCOMES: readonly OpsJobFailureOutcomeV1[] = ['failed', 'succeeded', 'heartbeat'];
const REASONS: readonly OpsJobFailureReasonV1[] = [
  'job-failed', 'deadline-exceeded', 'systemic-all-documents-failed',
  'transport', 'quota', 'stalled', 'schedule-missed', 'stale',
];
const SEVERITIES: readonly OpsJobFailureSeverityV1[] = ['warning', 'critical'];
const KINDS: readonly OpsJobKindV1[] = ['CronJob', 'Job', 'app-job'];

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'v', 'eventId', 'source', 'targetKey', 'jobRef', 'runId',
  'outcome', 'reason', 'severity', 'occurredAt', 'detail', 'links',
]);
const KNOWN_JOB_REF_KEYS = new Set(['namespace', 'kind', 'name']);
const KNOWN_LINK_KEYS = new Set(['logs', 'run']);

export type OpsJobFailureValidationCode =
  | 'not_an_object'
  | 'unknown_field'
  | 'bad_version'
  | 'bad_event_id'
  | 'bad_source'
  | 'bad_target_key'
  | 'bad_job_ref'
  | 'bad_run_id'
  | 'bad_outcome'
  | 'reason_required_on_failed'
  | 'reason_forbidden'
  | 'bad_reason'
  | 'severity_forbidden'
  | 'bad_severity'
  | 'bad_occurred_at'
  | 'bad_detail'
  | 'bad_links';

export type OpsJobFailureValidation =
  | { readonly ok: true; readonly event: OpsJobFailureV1 }
  | { readonly ok: false; readonly code: OpsJobFailureValidationCode; readonly message: string };

export interface OpsJobFailureValidationOptions {
  /** Server clock: when present the `occurredAt` freshness window is enforced. */
  readonly nowIso?: string;
}

const fail = (code: OpsJobFailureValidationCode, message: string): OpsJobFailureValidation => ({ ok: false, code, message });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCleanBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && NO_CONTROLS_PATTERN.test(value);
}

function isValidJobRefSegment(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > OPS_JOB_FAILURE_NAME_MAX_LENGTH) return false;
  if (value.length === 1) return SINGLE_CHAR_SEGMENT_PATTERN.test(value);
  return JOB_REF_SEGMENT_PATTERN.test(value);
}

/** Links must be absolute `https` URLs without credentials, so mails never carry `javascript:`. */
export function isValidOpsLink(value: unknown): value is string {
  if (!isCleanBoundedString(value, OPS_JOB_FAILURE_LINK_MAX_LENGTH)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username.length > 0 || parsed.password.length > 0) return false;
  if (parsed.hostname.length === 0) return false;
  return true;
}

function checkOccurredAt(value: unknown, nowIso: string | undefined): value is string {
  if (typeof value !== 'string' || !OPS_JOB_FAILURE_OCCURRED_AT_PATTERN.test(value)) return false;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return false;
  if (nowIso !== undefined) {
    if (!OPS_JOB_FAILURE_OCCURRED_AT_PATTERN.test(nowIso)) return false;
    const now = Date.parse(nowIso);
    if (Number.isNaN(now)) return false;
    if (at - now > OPS_JOB_FAILURE_OCCURRED_AT_MAX_SKEW_MS) return false;
    if (now - at > OPS_JOB_FAILURE_OCCURRED_AT_MAX_AGE_MS) return false;
  }
  return true;
}

export function validateOpsJobFailureV1(
  input: unknown,
  options: OpsJobFailureValidationOptions = {},
): OpsJobFailureValidation {
  if (!isRecord(input)) return fail('not_an_object', 'event must be an object');
  for (const key of Object.keys(input)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) return fail('unknown_field', `event carries unknown field ${JSON.stringify(key)}`);
  }
  if (input['v'] !== OPS_JOB_FAILURE_CONTRACT_V1) return fail('bad_version', 'event.v must be 1');
  const source = input['source'];
  if (source !== 'k8s' && source !== 'app') return fail('bad_source', 'event.source must be k8s or app');
  const eventId = input['eventId'];
  if (!isCleanBoundedString(eventId, OPS_JOB_FAILURE_EVENT_ID_MAX_LENGTH) || !eventId.startsWith(`${source}:`)) {
    return fail('bad_event_id', 'event.eventId must start with "<source>:"');
  }
  const targetKey = input['targetKey'];
  if (typeof targetKey !== 'string' || targetKey.length > OPS_JOB_FAILURE_TARGET_KEY_MAX_LENGTH || !TARGET_KEY_PATTERN.test(targetKey)) {
    return fail('bad_target_key', 'event.targetKey must be a lowercase product key');
  }
  const jobRef = input['jobRef'];
  if (!isRecord(jobRef)) return fail('bad_job_ref', 'event.jobRef must be an object');
  for (const key of Object.keys(jobRef)) {
    if (!KNOWN_JOB_REF_KEYS.has(key)) return fail('unknown_field', `event.jobRef carries unknown field ${JSON.stringify(key)}`);
  }
  const namespace = jobRef['namespace'];
  if (namespace !== undefined && !isValidJobRefSegment(namespace)) {
    return fail('bad_job_ref', 'event.jobRef.namespace must be a valid name segment when present');
  }
  if (!KINDS.includes(jobRef['kind'] as OpsJobKindV1)) return fail('bad_job_ref', 'event.jobRef.kind is not a known job kind');
  if (!isValidJobRefSegment(jobRef['name'])) {
    return fail('bad_job_ref', 'event.jobRef.name must be a valid name segment');
  }
  if (!isCleanBoundedString(input['runId'], OPS_JOB_FAILURE_EVENT_ID_MAX_LENGTH)) {
    return fail('bad_run_id', 'event.runId must be a non-empty string');
  }
  const outcome = input['outcome'];
  if (!OUTCOMES.includes(outcome as OpsJobFailureOutcomeV1)) return fail('bad_outcome', 'event.outcome is not known');
  const reason = input['reason'];
  const severity = input['severity'];
  if (outcome === 'failed') {
    if (reason === undefined) return fail('reason_required_on_failed', 'failed events require a reason');
    if (!REASONS.includes(reason as OpsJobFailureReasonV1)) return fail('bad_reason', 'event.reason is not in the closed taxonomy');
  } else {
    if (reason !== undefined) return fail('reason_forbidden', 'only failed events carry a reason');
    if (severity !== undefined) return fail('severity_forbidden', 'only failed events carry a severity');
  }
  if (severity !== undefined && !SEVERITIES.includes(severity as OpsJobFailureSeverityV1)) {
    return fail('bad_severity', 'event.severity must be warning or critical');
  }
  const occurredAt = input['occurredAt'];
  if (!checkOccurredAt(occurredAt, options.nowIso)) {
    return fail('bad_occurred_at', 'event.occurredAt must be a UTC ISO-8601 timestamp within the freshness window');
  }
  const links = input['links'];
  if (links !== undefined) {
    if (!isRecord(links)) return fail('bad_links', 'event.links must be an object when present');
    for (const key of Object.keys(links)) {
      if (!KNOWN_LINK_KEYS.has(key)) return fail('unknown_field', `event.links carries unknown field ${JSON.stringify(key)}`);
    }
    for (const key of ['logs', 'run'] as const) {
      const value = links[key];
      if (value !== undefined && !isValidOpsLink(value)) {
        return fail('bad_links', `event.links.${key} must be an absolute https URL without credentials`);
      }
    }
  }
  const detail = input['detail'];
  if (detail !== undefined && typeof detail !== 'string') return fail('bad_detail', 'event.detail must be a string when present');
  return {
    ok: true,
    event: {
      v: OPS_JOB_FAILURE_CONTRACT_V1,
      eventId, source, targetKey,
      jobRef: {
        ...(typeof namespace === 'string' ? { namespace } : {}),
        kind: jobRef['kind'] as OpsJobKindV1, name: jobRef['name'] as string,
      },
      runId: input['runId'] as string, outcome: outcome as OpsJobFailureOutcomeV1,
      ...(reason !== undefined ? { reason: reason as OpsJobFailureReasonV1 } : {}),
      ...(severity !== undefined ? { severity: severity as OpsJobFailureSeverityV1 } : {}),
      occurredAt: occurredAt as string,
      ...(typeof detail === 'string' && detail.length > 0 ? { detail: truncateOpsDetail(detail) } : {}),
      ...(links !== undefined ? {
        links: {
          ...((links as Record<string, unknown>)['logs'] !== undefined ? { logs: (links as Record<string, unknown>)['logs'] as string } : {}),
          ...((links as Record<string, unknown>)['run'] !== undefined ? { run: (links as Record<string, unknown>)['run'] as string } : {}),
        },
      } : {}),
    },
  };
}
