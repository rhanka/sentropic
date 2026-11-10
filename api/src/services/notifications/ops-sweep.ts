// Send sweep for ops alert mails (notify L1).
//
// Runs in the api process next to the outbox dispatcher: time-driven mails
// (24 h escalation, digest cadence), dead-man incidents (silent watches),
// then claimed pending deliveries resolved against live recipients at send
// time. Fail-closed: an unresolvable target fails the delivery and raises a
// configuration alert to the platform admins instead of rerouting the
// incident mail. Transient failures and cap hits requeue with a backoff; only
// exhausted or permanent failures are terminal.

import { sql } from 'drizzle-orm';
import {
  DEFAULT_OPS_NOTIFICATION_POLICY_V1,
  dueOpsTimeDrivenMails,
  isOpsHeartbeatOverdue,
  openOpsStaleIncident,
  type OpsAlertRecipientsPortV1,
  type OpsNotificationPolicyV1,
} from '@sentropic/cluster-mesh/notifications';
import { db } from '../../db/client';
import { logger } from '../../logger';
import {
  isOpsMailRetryableError,
  opsSendBackoffMs,
  opsTemMailer,
  renderOpsConfigMail,
  renderOpsMail,
} from './ops-mail';
import { createOpsPlatformAdminsPort, createOpsRecipientsPort } from './ops-recipients';
import { DrizzleOpsNotificationStore } from './ops-store';
import type { OpsClockPort, OpsDeliveryRecordV1, OpsMailerPort, OpsNotificationStorePort } from './ops-types';

export const OPS_SWEEP_INTERVAL_MS = 60_000;
export const OPS_SWEEP_CLAIM_LIMIT = 25;
export const OPS_SWEEP_MAX_SEND_ATTEMPTS = 5;
export const OPS_SWEEP_STALE_SENDING_MIN = 10;
/** Delay before a cap-hit delivery is retried (the hourly window slides). */
export const OPS_SWEEP_CAP_RETRY_MS = 15 * 60 * 1000;
/** Recipient-weighted ceiling across all targets in the trailing hour. */
export const OPS_SWEEP_MAX_MAILS_PER_HOUR_GLOBAL = 100;
/** Recipient-weighted ceiling per address in the trailing hour. */
export const OPS_SWEEP_MAX_MAILS_PER_HOUR_PER_RECIPIENT = 20;

export interface OpsSweepDeps {
  readonly store?: OpsNotificationStorePort;
  readonly mailer?: OpsMailerPort;
  readonly recipients?: OpsAlertRecipientsPortV1;
  readonly configRecipients?: OpsAlertRecipientsPortV1;
  readonly clock?: OpsClockPort;
  readonly policy?: OpsNotificationPolicyV1;
  readonly withIncidentLock?: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  readonly withTargetLock?: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  readonly withGlobalLock?: <T>(key: string, work: () => Promise<T>) => Promise<T>;
}

export interface OpsSweepResult {
  readonly timeDriven: number;
  readonly deadMan: number;
  readonly sent: number;
  readonly failed: number;
  readonly suppressed: number;
  readonly reclaimed: number;
  readonly configAlerts: number;
}

const advisoryLock = (domain: string) =>
  async <T>(key: string, work: () => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${domain + key}))`);
      return work();
    });

const withAdvisoryIncidentLock = advisoryLock('ops-incident:');
const withAdvisoryTargetLock = advisoryLock('ops-target:');
const withAdvisoryGlobalLock = advisoryLock('ops-send-global:');

/** Production port singletons: the recipients cache must survive across sweeps. */
let defaultRecipientsPort: OpsAlertRecipientsPortV1 | null = null;
let defaultConfigRecipientsPort: OpsAlertRecipientsPortV1 | null = null;

const getDefaultRecipientsPort = (): OpsAlertRecipientsPortV1 => {
  if (!defaultRecipientsPort) defaultRecipientsPort = createOpsRecipientsPort();
  return defaultRecipientsPort;
};

const getDefaultConfigRecipientsPort = (): OpsAlertRecipientsPortV1 => {
  if (!defaultConfigRecipientsPort) defaultConfigRecipientsPort = createOpsPlatformAdminsPort();
  return defaultConfigRecipientsPort;
};

type SweepStore = OpsNotificationStorePort;

async function resolveRecipients(
  store: SweepStore,
  delivery: OpsDeliveryRecordV1,
  recipients: OpsAlertRecipientsPortV1,
  configRecipients: OpsAlertRecipientsPortV1,
  nowIso: string,
  result: { failed: number; configAlerts: number },
): Promise<readonly { accountId: string; email: string; basis: string }[] | null> {
  let targets: readonly { accountId: string; email: string; basis: string }[];
  try {
    targets = await recipients.listRecipientsForTarget(delivery.targetKey);
  } catch (error) {
    // The port only throws on transient fetch/timeout faults: retry bounded.
    const message = error instanceof Error ? error.message.slice(0, 500) : 'ops recipients failed';
    await failOrRetry(store, delivery, message, nowIso);
    result.failed += 1;
    return null;
  }
  if (targets.length > 0) return targets;
  // Fail-closed: the incident mail is never rerouted. A configuration alert
  // goes to the platform admins instead; the original delivery is terminal
  // so one bad target cannot wedge the queue with infinite retries. A
  // transient config-port fault requeues the original instead (retry later).
  try {
    if (!(await store.hasUnsentDelivery(delivery.incidentId, 'config'))) {
      const admins = await configRecipients.listRecipientsForTarget(delivery.targetKey);
      if (admins.length === 0) {
        logger.error({ targetKey: delivery.targetKey }, 'ops config alert has no platform admin either; incident mail dropped loudly');
      } else {
        const rendered = renderOpsConfigMail(delivery.targetKey, delivery.incidentId, 'no usable recipient for target');
        await store.insertDelivery({
          incidentId: delivery.incidentId, targetKey: delivery.targetKey, kind: 'config',
          subject: rendered.subject, textBody: rendered.text, htmlBody: rendered.html,
          eventId: delivery.eventId ?? undefined,
        });
        result.configAlerts += 1;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'ops config recipients failed';
    await failOrRetry(store, delivery, message, nowIso);
    result.failed += 1;
    return null;
  }
  await store.markDeliveryFailed(delivery.id, 'ops no usable recipient for target');
  result.failed += 1;
  return null;
}

async function failOrRetry(
  store: SweepStore,
  delivery: OpsDeliveryRecordV1,
  message: string,
  nowIso: string,
): Promise<void> {
  if (delivery.attempts > OPS_SWEEP_MAX_SEND_ATTEMPTS) {
    await store.markDeliveryFailed(delivery.id, message);
    return;
  }
  await store.markDeliveryRetryable(
    delivery.id, message, new Date(Date.parse(nowIso) + opsSendBackoffMs(delivery.attempts)).toISOString(),
  );
}

/**
 * Hard recipient-weighted caps enforced on the batch itself (target, global,
 * per-address, trailing hour). Counts are already windowed by the store
 * (`sent_at` strictly inside the trailing hour), so a plain threshold
 * comparison is exact. Returns the outcome after persisting progress:
 * `sent` when every pending recipient was served (delivery marked sent),
 * `deferred` when the budget ran out first (served recipients persisted,
 * the caller requeues the remainder without consuming the retry budget).
 */
async function sendToAllCapped(
  store: SweepStore,
  mailer: OpsMailerPort,
  delivery: OpsDeliveryRecordV1,
  targets: readonly { accountId: string; email: string; basis: string }[],
  clock: OpsClockPort,
  policy: OpsNotificationPolicyV1,
  nowIso: string,
): Promise<'sent' | 'deferred'> {
  const sentEmails = new Set(delivery.recipients.map((entry) => entry.email));
  const pending = targets.filter((recipient) => !sentEmails.has(recipient.email));
  const entries: { accountId: string; email: string; basis: string; messageId: string }[] =
    delivery.recipients.map((entry) => ({
      accountId: entry.accountId, email: entry.email, basis: entry.basis, messageId: entry.messageId ?? '',
    }));
  let firstMessageId = delivery.messageId;
  if (pending.length === 0) {
    const sentAt = clock();
    await store.markDeliverySent(delivery.id, firstMessageId ?? '', entries, sentAt);
    await store.touchIncidentMailAt(delivery.incidentId, sentAt);
    return 'sent';
  }
  const sinceIso = new Date(Date.parse(nowIso) - 60 * 60 * 1000).toISOString();
  const counts = await store.listRecentSentMailCounts(sinceIso);
  const targetMails = counts.find((row) => row.targetKey === delivery.targetKey)?.mails ?? 0;
  const globalMails = counts.reduce((sum, row) => sum + row.mails, 0);
  const allowed = Math.max(
    0,
    Math.min(policy.maxMailsPerHourPerTarget - targetMails, OPS_SWEEP_MAX_MAILS_PER_HOUR_GLOBAL - globalMails),
  );
  let sentThisBatch = 0;
  let deferred = false;
  for (const recipient of pending) {
    if (sentThisBatch >= allowed) {
      deferred = true;
      break;
    }
    if ((await store.countRecentSentTo(recipient.email, sinceIso)) >= OPS_SWEEP_MAX_MAILS_PER_HOUR_PER_RECIPIENT) {
      deferred = true;
      continue;
    }
    let messageId: string;
    try {
      messageId = await mailer.send({
        to: recipient.email, subject: delivery.subject, text: delivery.textBody, html: delivery.htmlBody,
      });
    } catch (error) {
      if (isOpsMailRetryableError(error)) {
        throw error instanceof Error ? error : new Error('ops_mail_delivery_failed');
      }
      await store.markDeliveryFailed(delivery.id, error instanceof Error ? error.message.slice(0, 500) : 'ops send failed');
      throw new OpsSendAbortError();
    }
    const entry = { ...recipient, messageId };
    await store.markDeliveryRecipientSent(delivery.id, entry);
    entries.push(entry);
    sentEmails.add(recipient.email);
    if (!firstMessageId) firstMessageId = messageId;
    sentThisBatch += 1;
  }
  if (deferred || sentEmails.size < new Set(targets.map((recipient) => recipient.email)).size) {
    return 'deferred';
  }
  const sentAt = clock();
  await store.markDeliverySent(delivery.id, firstMessageId ?? '', entries, sentAt);
  await store.touchIncidentMailAt(delivery.incidentId, sentAt);
  return 'sent';
}

export async function runOpsNotificationSweep(deps: OpsSweepDeps = {}): Promise<OpsSweepResult> {
  const store = deps.store ?? new DrizzleOpsNotificationStore(db);
  const mailer = deps.mailer ?? opsTemMailer;
  const recipients = deps.recipients ?? getDefaultRecipientsPort();
  const configRecipients = deps.configRecipients ?? getDefaultConfigRecipientsPort();
  const clock = deps.clock ?? (() => new Date().toISOString());
  const policy = deps.policy ?? DEFAULT_OPS_NOTIFICATION_POLICY_V1;
  const withIncidentLock = deps.withIncidentLock ?? withAdvisoryIncidentLock;
  const withTargetLock = deps.withTargetLock ?? withAdvisoryTargetLock;
  const withGlobalLock = deps.withGlobalLock ?? withAdvisoryGlobalLock;
  const result = { timeDriven: 0, deadMan: 0, sent: 0, failed: 0, suppressed: 0, reclaimed: 0, configAlerts: 0 };
  const nowIso = clock();

  result.reclaimed = await store.reclaimStaleSending(
    new Date(Date.parse(nowIso) - OPS_SWEEP_STALE_SENDING_MIN * 60 * 1000).toISOString(),
  );

  for (const firing of await store.listFiringIncidents()) {
    await withIncidentLock(firing.key, async () => {
      const current = await store.loadIncident(firing.key);
      if (!current || current.status !== 'firing') return;
      const due = dueOpsTimeDrivenMails(current, clock(), policy);
      if (due.mails.length === 0) return;
      const deliveries = due.mails.map((kind) => {
        const rendered = renderOpsMail(kind, due.state);
        return {
          incidentId: due.state.key, targetKey: due.state.targetKey, kind,
          subject: rendered.subject, textBody: rendered.text, htmlBody: rendered.html,
        };
      });
      await store.saveIncidentWithDeliveries(due.state, deliveries);
      result.timeDriven += due.mails.length;
    });
  }

  for (const watch of await store.listHeartbeatWatches()) {
    if (!isOpsHeartbeatOverdue(watch.lastHeartbeatAt, nowIso, policy)) continue;
    await withIncidentLock(watch.key, async () => {
      const current = await store.loadIncident(watch.key);
      if (!current || current.status === 'firing') return;
      if (!isOpsHeartbeatOverdue(current.lastHeartbeatAt, clock(), policy)) return;
      const stale = openOpsStaleIncident(
        current.targetKey, current.jobNamespace, current.jobName, current.jobKind, clock(),
      );
      const rendered = renderOpsMail('firing', stale);
      await store.saveIncidentWithDeliveries(stale, [{
        incidentId: stale.key, targetKey: stale.targetKey, kind: 'firing',
        subject: rendered.subject, textBody: rendered.text, htmlBody: rendered.html,
      }]);
      result.deadMan += 1;
    });
  }

  const pending = await store.claimPendingDeliveries(OPS_SWEEP_CLAIM_LIMIT, nowIso);
  const deferForCap = async (deliveryId: string, atIso: string): Promise<void> => {
    await store.markDeliveryCapDelayed(
      deliveryId, 'ops send cap exceeded',
      new Date(Date.parse(atIso) + OPS_SWEEP_CAP_RETRY_MS).toISOString(),
    );
    result.suppressed += 1;
  };
  for (const delivery of pending) {
    try {
      if (delivery.attempts > OPS_SWEEP_MAX_SEND_ATTEMPTS) {
        await store.markDeliveryFailed(delivery.id, 'ops send attempts exceeded');
        result.failed += 1;
        continue;
      }
      // Global send lock serializes the cap check and the sends across
      // targets; the per-target lock still serializes same-target sweeps.
      await withGlobalLock('send', async () => {
        await withTargetLock(delivery.targetKey, async () => {
          const atIso = clock();
          if (delivery.kind === 'config') {
            let targets: readonly { accountId: string; email: string; basis: string }[];
            try {
              targets = await configRecipients.listRecipientsForTarget(delivery.targetKey);
            } catch (error) {
              const message = error instanceof Error ? error.message.slice(0, 500) : 'ops config recipients failed';
              await failOrRetry(store, delivery, message, atIso);
              result.failed += 1;
              return;
            }
            if (targets.length === 0) {
              logger.error({ targetKey: delivery.targetKey }, 'ops config alert has no platform admin either; incident mail dropped loudly');
              await store.markDeliveryFailed(delivery.id, 'ops config alert has no platform admin either');
              result.failed += 1;
              return;
            }
            const outcome = await sendToAllCapped(store, mailer, delivery, targets, clock, policy, atIso);
            if (outcome === 'sent') result.sent += 1;
            else await deferForCap(delivery.id, atIso);
            return;
          }
          const targets = await resolveRecipients(store, delivery, recipients, configRecipients, atIso, result);
          if (!targets) return;
          const outcome = await sendToAllCapped(store, mailer, delivery, targets, clock, policy, atIso);
          if (outcome === 'sent') result.sent += 1;
          else await deferForCap(delivery.id, atIso);
        });
      });
    } catch (error) {
      if (error instanceof OpsSendAbortError) {
        // Permanent provider error: the delivery is already failed above.
        result.failed += 1;
        continue;
      }
      const message = error instanceof Error ? error.message.slice(0, 500) : 'ops send failed';
      await failOrRetry(store, delivery, message, clock());
      result.failed += 1;
    }
  }
  return result;
}

/** Control flow: a permanent provider error already failed the delivery. */
class OpsSendAbortError extends Error {
  constructor() {
    super('ops send aborted after permanent failure');
    this.name = 'OpsSendAbortError';
  }
}

/** Sweep wrapper: a sweep failure never crashes the server (outbox pattern). */
export async function runOpsNotificationSweepSafe(): Promise<void> {
  try {
    const result = await runOpsNotificationSweep();
    if (result.sent > 0 || result.failed > 0 || result.suppressed > 0 || result.deadMan > 0) {
      logger.info(result, 'ops-notification-sweep: sweep completed');
    }
  } catch (error) {
    logger.error({ err: error }, 'ops-notification-sweep: sweep failed');
  }
}
