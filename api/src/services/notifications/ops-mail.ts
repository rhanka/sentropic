// Render + transport for ops alert mails (notify L1, email TEM only in v1).
//
// All cluster-provided strings are untrusted: subjects are reduced to one
// sanitized line, the HTML escape mirrors the identity mail path, and no
// mail ever carries tenant payload data — only the job identity, the closed
// reason class, counters and links.

import type { OpsIncidentMailV1, OpsIncidentStateV1 } from '@sentropic/cluster-mesh/notifications';
import { sendTransactionalEmail } from '../scw-tem-client';
import type { OpsMailerPort } from './ops-types';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&gt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

/**
 * Subjects travel on one line: strip control characters and collapse
 * whitespace so a crafted job name cannot smuggle header-like lines into the
 * subject, then cap the length.
 */
export function sanitizeOpsSubject(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export interface OpsRenderedMailV1 {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const describeJob = (state: Pick<OpsIncidentStateV1, 'targetKey' | 'jobNamespace' | 'jobName' | 'jobKind'>): string =>
  `${state.targetKey} / ${state.jobNamespace && state.jobNamespace.length > 0 ? `${state.jobNamespace}/` : ''}${state.jobName} (${state.jobKind})`;

const describeCommon = (
  state: OpsIncidentStateV1,
): { readonly header: string; readonly facts: string; readonly lastRun: string; readonly links: string } => {
  const header = sanitizeOpsSubject(`[job-failure] ${state.targetKey}/${state.jobName}`);
  const facts = [
    `Target: ${state.targetKey}`,
    `Job: ${describeJob(state)}`,
    `Reason: ${state.lastReason ?? 'unknown'}`,
    `Severity: ${state.lastSeverity ?? 'warning'}`,
    `Occurrences: ${state.occurrenceCount}`,
    `Consecutive failures: ${state.consecutiveFailures}`,
    `First seen: ${state.firstSeenAt}`,
    `Last seen: ${state.lastSeenAt}`,
  ].join('\n');
  const lastRun = state.lastRunId ? `\nLast run: ${state.lastRunId}` : '';
  const links = state.lastLinks?.logs ?? state.lastLinks?.run ?? null;
  return { header, facts, links: links ? `\nLinks: ${links}` : '', lastRun };
};

/** Render the subject/text/html triple for one requested mail kind. */
export function renderOpsMail(kind: OpsIncidentMailV1, state: OpsIncidentStateV1): OpsRenderedMailV1 {
  const { header, facts, links, lastRun } = describeCommon(state);
  const titles: Record<OpsIncidentMailV1, string> = {
    firing: 'firing',
    escalation: 'ESCALATED (still failing)',
    digest: 'still failing (daily digest)',
    recovery: 'recovered',
  };
  const subject = sanitizeOpsSubject(`${header} ${titles[kind]}`);
  const text = `${subject}\n\n${facts}${lastRun}${links}\n\nSentropic platform alerts`;
  const html = [
    `<p><strong>${escapeHtml(subject)}</strong></p>`,
    ...facts.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`),
    ...(state.lastRunId ? [`<p>${escapeHtml(`Last run: ${state.lastRunId}`)}</p>`] : []),
    ...(state.lastLinks?.logs ?? state.lastLinks?.run
      ? [`<p>${escapeHtml(`Links: ${(state.lastLinks?.logs ?? state.lastLinks?.run) as string}`)}</p>`]
      : []),
    `<p>Sentropic platform alerts</p>`,
  ].join('\n');
  return { subject, text, html };
}

/**
 * Configuration alert to the platform admins: a target has no usable
 * recipient, so an incident mail was failed instead of rerouted. Carries only
 * the routing identity, never the incident's job detail.
 */
export function renderOpsConfigMail(
  targetKey: string,
  incidentId: string,
  reason: string,
): OpsRenderedMailV1 {
  const subject = sanitizeOpsSubject(`[job-failure] ${targetKey} recipients misconfigured`);
  const text = [
    subject,
    '',
    `Target: ${targetKey}`,
    `Incident: ${incidentId}`,
    `Reason: ${reason}`,
    '',
    'Operator action: declare admins for this target in OPS_JOB_FAILURE_TARGETS_JSON',
    '(account ids that exist and are active in the identity store), then the',
    'failed delivery can be re-queued from the ops_notification_deliveries audit.',
    '',
    'Sentropic platform alerts',
  ].join('\n');
  const html = text.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('\n');
  return { subject, text, html };
}

export class OpsMailError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly providerStatus: number | null,
  ) {
    super(message);
    this.name = 'OpsMailError';
  }
}

const HTTP_STATUS_PATTERN = /HTTP (\d{3})\b/;

/** Permanent (4xx) vs transient (network, timeout, 429, 5xx) provider faults. */
export function isOpsMailRetryableError(error: unknown): boolean {
  if (error instanceof OpsMailError) return error.retryable;
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
    const match = HTTP_STATUS_PATTERN.exec(error.message);
    if (match) {
      const status = Number(match[1]);
      return status === 429 || status >= 500;
    }
    // Unclassified errors (DNS, reset, mock rejections without a status)
    // retry bounded rather than dropping the alert.
    return true;
  }
  return false;
}

/** Bounded backoff for transient send faults: 2^attempts minutes, max 1 h. */
export function opsSendBackoffMs(attempts: number): number {
  const bounded = Math.min(Math.max(attempts, 1), 6);
  return Math.min(2 ** bounded * 60 * 1000, 60 * 60 * 1000);
}

/** TEM transport behind the mailer port; provider errors keep retryability. */
export const sendOpsAlertMail = async (input: {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}): Promise<string> => {
  try {
    const { messageId } = await sendTransactionalEmail(input);
    return messageId;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown TEM error';
    const match = error instanceof Error ? HTTP_STATUS_PATTERN.exec(error.message) : null;
    const status = match ? Number(match[1]) : null;
    const retryable = status === null ? true : status === 429 || status >= 500;
    throw new OpsMailError(`ops_mail_delivery_failed: ${message}`.slice(0, 500), retryable, status);
  }
};

export const opsTemMailer: OpsMailerPort = { send: sendOpsAlertMail };
