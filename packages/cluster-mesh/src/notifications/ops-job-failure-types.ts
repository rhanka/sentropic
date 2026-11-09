// Frozen v1 shapes for platform job-failure events (notify L1).
//
// Two emitters share this single closed shape: the k8s watcher (source `k8s`)
// and in-app jobs (source `app`). No emitter speaks mail; the platform
// aggregate owns incident state, digest, escalation and delivery.
//
// The routing target is a PRODUCT key (`targetKey`), mapped from the k8s
// namespace label `sentropic.io/target`. Early drafts named this field
// `tenantSlug`; the wire name is `targetKey` and no identity tenant is
// assumed on the platform side. `prod` and `preprod` are distinct keys.

/** Frozen contract version carried on every event. */
export const OPS_JOB_FAILURE_CONTRACT_V1 = 1 as const;

export type OpsJobFailureSourceV1 = 'k8s' | 'app';

/** `heartbeat` keeps a watch alive; only `succeeded` resolves an incident. */
export type OpsJobFailureOutcomeV1 = 'failed' | 'succeeded' | 'heartbeat';

/**
 * Closed reason taxonomy. App emitters project their local reasons onto it;
 * the local detail stays in `detail`. There is no `unknown` prefix: a reason
 * the emitter cannot classify must still pick the closest class.
 */
export type OpsJobFailureReasonV1 =
  | 'job-failed'
  | 'deadline-exceeded'
  | 'systemic-all-documents-failed'
  | 'transport'
  | 'quota'
  | 'stalled'
  | 'schedule-missed'
  | 'stale';

export type OpsJobFailureSeverityV1 = 'warning' | 'critical';

export type OpsJobKindV1 = 'CronJob' | 'Job' | 'app-job';

export interface OpsJobRefV1 {
  readonly namespace?: string;
  readonly kind: OpsJobKindV1;
  readonly name: string;
}

export interface OpsJobFailureLinksV1 {
  readonly logs?: string;
  readonly run?: string;
}

export interface OpsJobFailureV1 {
  readonly v: typeof OPS_JOB_FAILURE_CONTRACT_V1;
  /** Idempotence key `<source>:<runRef>` with free suffixes; replays are no-ops. */
  readonly eventId: string;
  readonly source: OpsJobFailureSourceV1;
  /** Product routing key (k8s label `sentropic.io/target`; never an email). */
  readonly targetKey: string;
  readonly jobRef: OpsJobRefV1;
  /** k8s Job uid/name or app run id. */
  readonly runId: string;
  readonly outcome: OpsJobFailureOutcomeV1;
  /** Required on `failed`; forbidden on `succeeded`/`heartbeat`. */
  readonly reason?: OpsJobFailureReasonV1;
  /** Optional on `failed`; forbidden on `succeeded`/`heartbeat`. */
  readonly severity?: OpsJobFailureSeverityV1;
  /** Emitter clock, ISO-8601. */
  readonly occurredAt: string;
  /** Free detail, truncated server-side to 1 KiB. Untrusted: escape on render. */
  readonly detail?: string;
  readonly links?: OpsJobFailureLinksV1;
}

export const OPS_JOB_FAILURE_EVENT_ID_MAX_LENGTH = 256;
export const OPS_JOB_FAILURE_TARGET_KEY_MAX_LENGTH = 128;
export const OPS_JOB_FAILURE_NAME_MAX_LENGTH = 253;
export const OPS_JOB_FAILURE_DETAIL_MAX_BYTES = 1024;
export const OPS_JOB_FAILURE_LINK_MAX_LENGTH = 2048;
/** Strict emitter-clock shape: full UTC ISO-8601 with trailing `Z`. */
export const OPS_JOB_FAILURE_OCCURRED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/u;
/** Future tolerance for emitter clock skew. */
export const OPS_JOB_FAILURE_OCCURRED_AT_MAX_SKEW_MS = 5 * 60 * 1000;
/** Events older than this are stale replays, rejected at ingestion. */
export const OPS_JOB_FAILURE_OCCURRED_AT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Largest ingestion body the route reads before parsing (detail is capped at 1 KiB inside it). */
export const OPS_JOB_FAILURE_MAX_BODY_BYTES = 32 * 1024;
/** Allowed `basis` values in product recipients answers (conductor contract v1). */
export const OPS_JOB_FAILURE_RECIPIENT_BASES_V1 = ['workspace:manage_members', 'app:is_admin'] as const;

/** Byte-safe truncation of the untrusted free detail (never splits UTF-8). */
export function truncateOpsDetail(detail: string): string {
  const bytes = Buffer.from(detail, 'utf8');
  if (bytes.length <= OPS_JOB_FAILURE_DETAIL_MAX_BYTES) return detail;
  let end = OPS_JOB_FAILURE_DETAIL_MAX_BYTES;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

/**
 * Durable incident key: one incident per (target, namespace, job name).
 * Segments are `encodeURIComponent`-escaped so a `/` inside a job or
 * namespace name can never collide two distinct triples.
 */
export function opsIncidentKey(targetKey: string, namespace: string | undefined, jobName: string): string {
  return `${encodeURIComponent(targetKey)}/${encodeURIComponent(namespace ?? '')}/${encodeURIComponent(jobName)}`;
}

/**
 * Cross-source canonical run key: the k8s watcher and an in-app emitter
 * reporting the SAME execution (same target, job, run, outcome) share this
 * key even though their `eventId`s differ (each is `<source>:<runRef>`).
 * The second source to report a known canonical key is a cross-source
 * duplicate: recorded, but it opens no incident and queues no mail.
 */
export function opsCanonicalRunKey(
  targetKey: string,
  namespace: string | undefined,
  jobName: string,
  runId: string,
  outcome: OpsJobFailureOutcomeV1,
): string {
  return `canon:${encodeURIComponent(targetKey)}/${encodeURIComponent(namespace ?? '')}/${encodeURIComponent(jobName)}/${encodeURIComponent(runId)}/${outcome}`;
}
