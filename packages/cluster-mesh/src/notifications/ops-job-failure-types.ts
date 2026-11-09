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
 * `/` cannot appear in a product key or a k8s namespace/job name, so the
 * triple is unambiguous without escaping.
 */
export function opsIncidentKey(targetKey: string, namespace: string | undefined, jobName: string): string {
  return `${targetKey}/${namespace ?? ''}/${jobName}`;
}
