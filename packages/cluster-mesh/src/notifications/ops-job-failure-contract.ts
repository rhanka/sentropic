// Validation for the frozen OpsJobFailureV1 ingestion payload (notify L1). Pure: no clock, no I/O.

import {
  OPS_JOB_FAILURE_CONTRACT_V1,
  OPS_JOB_FAILURE_DETAIL_MAX_BYTES,
  OPS_JOB_FAILURE_EVENT_ID_MAX_LENGTH,
  OPS_JOB_FAILURE_LINK_MAX_LENGTH,
  OPS_JOB_FAILURE_NAME_MAX_LENGTH,
  OPS_JOB_FAILURE_TARGET_KEY_MAX_LENGTH,
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
  OPS_JOB_FAILURE_TARGET_KEY_MAX_LENGTH,
  opsIncidentKey,
  truncateOpsDetail,
};

const TARGET_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

const OUTCOMES: readonly OpsJobFailureOutcomeV1[] = ['failed', 'succeeded', 'heartbeat'];
const REASONS: readonly OpsJobFailureReasonV1[] = [
  'job-failed', 'deadline-exceeded', 'systemic-all-documents-failed',
  'transport', 'quota', 'stalled', 'schedule-missed', 'stale',
];
const SEVERITIES: readonly OpsJobFailureSeverityV1[] = ['warning', 'critical'];
const KINDS: readonly OpsJobKindV1[] = ['CronJob', 'Job', 'app-job'];

export type OpsJobFailureValidationCode =
  | 'not_an_object'
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
  | 'bad_links';

export type OpsJobFailureValidation =
  | { readonly ok: true; readonly event: OpsJobFailureV1 }
  | { readonly ok: false; readonly code: OpsJobFailureValidationCode; readonly message: string };

const fail = (code: OpsJobFailureValidationCode, message: string): OpsJobFailureValidation => ({ ok: false, code, message });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function validateOpsJobFailureV1(input: unknown): OpsJobFailureValidation {
  if (!isRecord(input)) return fail('not_an_object', 'event must be an object');
  if (input['v'] !== OPS_JOB_FAILURE_CONTRACT_V1) return fail('bad_version', 'event.v must be 1');
  const source = input['source'];
  if (source !== 'k8s' && source !== 'app') return fail('bad_source', 'event.source must be k8s or app');
  const eventId = input['eventId'];
  if (!isNonEmptyString(eventId, OPS_JOB_FAILURE_EVENT_ID_MAX_LENGTH) || !eventId.startsWith(`${source}:`)) {
    return fail('bad_event_id', 'event.eventId must start with "<source>:"');
  }
  const targetKey = input['targetKey'];
  if (typeof targetKey !== 'string' || targetKey.length > OPS_JOB_FAILURE_TARGET_KEY_MAX_LENGTH || !TARGET_KEY_PATTERN.test(targetKey)) {
    return fail('bad_target_key', 'event.targetKey must be a lowercase product key');
  }
  const jobRef = input['jobRef'];
  if (!isRecord(jobRef)) return fail('bad_job_ref', 'event.jobRef must be an object');
  const namespace = jobRef['namespace'];
  if (namespace !== undefined && !isNonEmptyString(namespace, OPS_JOB_FAILURE_NAME_MAX_LENGTH)) {
    return fail('bad_job_ref', 'event.jobRef.namespace must be a non-empty string when present');
  }
  if (!KINDS.includes(jobRef['kind'] as OpsJobKindV1)) return fail('bad_job_ref', 'event.jobRef.kind is not a known job kind');
  if (!isNonEmptyString(jobRef['name'], OPS_JOB_FAILURE_NAME_MAX_LENGTH)) {
    return fail('bad_job_ref', 'event.jobRef.name must be a non-empty string');
  }
  if (!isNonEmptyString(input['runId'], OPS_JOB_FAILURE_EVENT_ID_MAX_LENGTH)) {
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
  if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) {
    return fail('bad_occurred_at', 'event.occurredAt must be an ISO-8601 timestamp');
  }
  const links = input['links'];
  if (links !== undefined) {
    if (!isRecord(links)) return fail('bad_links', 'event.links must be an object when present');
    for (const key of ['logs', 'run'] as const) {
      const value = links[key];
      if (value !== undefined && !isNonEmptyString(value, OPS_JOB_FAILURE_LINK_MAX_LENGTH)) {
        return fail('bad_links', `event.links.${key} must be a non-empty string when present`);
      }
    }
  }
  const detail = input['detail'];
  if (detail !== undefined && typeof detail !== 'string') return fail('bad_job_ref', 'event.detail must be a string when present');
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
