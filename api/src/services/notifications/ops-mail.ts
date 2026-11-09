// Render + transport for ops alert mails (notify L1, email TEM only in v1).
//
// All cluster-provided strings are untrusted: the HTML escape mirrors the
// identity mail path and no mail ever carries tenant payload data — only the
// job identity, the closed reason class, counters and links.

import type { OpsIncidentMailV1, OpsIncidentStateV1 } from '@sentropic/cluster-mesh/notifications';
import { sendTransactionalEmail } from '../scw-tem-client';
import type { OpsMailerPort } from './ops-types';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

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
  const header = `[job-failure] ${state.targetKey}/${state.jobName}`;
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
  const subject = `${header} ${titles[kind]}`;
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

/** TEM transport behind the mailer port; provider errors surface untruncated codes. */
export const sendOpsAlertMail = async (input: {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}): Promise<string> => {
  try {
    const { messageId } = await sendTransactionalEmail(input);
    return messageId;
  } catch {
    throw new Error('ops_mail_delivery_failed');
  }
};

export const opsTemMailer: OpsMailerPort = { send: sendOpsAlertMail };
