import '../modules/topology-guard.js';

export {
  OPS_JOB_FAILURE_CONTRACT_V1, OPS_JOB_FAILURE_DETAIL_MAX_BYTES, OPS_JOB_FAILURE_EVENT_ID_MAX_LENGTH,
  OPS_JOB_FAILURE_LINK_MAX_LENGTH, OPS_JOB_FAILURE_MAX_BODY_BYTES, OPS_JOB_FAILURE_NAME_MAX_LENGTH,
  OPS_JOB_FAILURE_OCCURRED_AT_MAX_AGE_MS, OPS_JOB_FAILURE_OCCURRED_AT_MAX_SKEW_MS,
  OPS_JOB_FAILURE_OCCURRED_AT_PATTERN, OPS_JOB_FAILURE_RECIPIENT_BASES_V1,
  OPS_JOB_FAILURE_TARGET_KEY_MAX_LENGTH,
  fingerprintOpsJobFailureEvent, opsCanonicalRunKey, opsIncidentKey, truncateOpsDetail,
  type OpsJobFailureLinksV1, type OpsJobFailureOutcomeV1, type OpsJobFailureReasonV1,
  type OpsJobFailureSeverityV1, type OpsJobFailureSourceV1, type OpsJobFailureV1,
  type OpsJobKindV1, type OpsJobRefV1,
} from './ops-job-failure-types.js';
export {
  isValidOpsLink, validateOpsJobFailureV1,
  type OpsJobFailureValidation, type OpsJobFailureValidationCode, type OpsJobFailureValidationOptions,
} from './ops-job-failure-contract.js';
export {
  DEFAULT_OPS_NOTIFICATION_POLICY_V1, isOpsStaleEvent, lastKnownOccurredAt,
  openIncident, openDormantWatch, openOpsStaleIncident,
  type OpsIncidentMailV1, type OpsIncidentStateV1, type OpsIncidentStatusV1,
  type OpsIncidentTransitionV1, type OpsNotificationPolicyV1,
} from './incident-state.js';
export { applyOpsJobFailureEvent } from './incident-policy.js';
export {
  dueOpsTimeDrivenMails, isOpsHeartbeatOverdue, isOpsMailCapExceeded,
} from './incident-schedule.js';
export {
  createDeclaredOpsRecipientsPort, normalizeOpsRecipientEmail,
  type OpsAccountLookupV1, type OpsAccountRecordV1, type OpsAlertRecipientV1,
  type OpsAlertRecipientsPortV1, type OpsDeclaredRecipientsInputV1, type OpsRecipientSkipReason,
} from './recipients.js';
export {
  createCachedOpsRecipientsPort, fetchOpsProductRecipients, validateOpsProductRecipientsPayload,
  OPS_PRODUCT_RECIPIENTS_CACHE_TTL_MS, OPS_PRODUCT_RECIPIENTS_STALE_MS, OPS_PRODUCT_RECIPIENTS_TIMEOUT_MS,
  OpsProductRecipientsError,
  type OpsCachedProductRecipientsInput, type OpsFetchLike, type OpsFetchProductRecipientsInput,
  type OpsMinimalResponse, type OpsProductAdminEntryV1, type OpsProductRecipientsFailureCode,
  type OpsValidatedProductRecipientsV1,
} from './recipients-http.js';
