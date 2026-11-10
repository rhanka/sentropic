// Send sweep for ops alert mails (notify L1).
//
// Runs in the api process next to the outbox dispatcher: time-driven mails
// (24 h escalation, digest cadence), dead-man incidents (silent watches),
// then claimed pending deliveries resolved against live recipients at send
// time. One delivery = one TEM mail per recipient; the per-target hourly cap
// suppresses instead of dropping (counted in the next digest).

import { sql } from 'drizzle-orm';
import {
  DEFAULT_OPS_NOTIFICATION_POLICY_V1,
  dueOpsTimeDrivenMails,
  isOpsHeartbeatOverdue,
  isOpsMailCapExceeded,
  openOpsStaleIncident,
  type OpsAlertRecipientsPortV1,
  type OpsNotificationPolicyV1,
} from '@sentropic/cluster-mesh/notifications';
import { db } from '../../db/client';
import { logger } from '../../logger';
import { opsTemMailer, renderOpsMail } from './ops-mail';
import { createOpsRecipientsPort } from './ops-recipients';
import { DrizzleOpsNotificationStore } from './ops-store';
import type { OpsClockPort, OpsMailerPort, OpsNotificationStorePort } from './ops-types';

export const OPS_SWEEP_INTERVAL_MS = 60_000;
export const OPS_SWEEP_CLAIM_LIMIT = 25;
export const OPS_SWEEP_MAX_SEND_ATTEMPTS = 5;
export const OPS_SWEEP_STALE_SENDING_MIN = 10;

export interface OpsSweepDeps {
  readonly store?: OpsNotificationStorePort;
  readonly mailer?: OpsMailerPort;
  readonly recipients?: OpsAlertRecipientsPortV1;
  readonly clock?: OpsClockPort;
  readonly policy?: OpsNotificationPolicyV1;
  readonly withIncidentLock?: <T>(key: string, work: () => Promise<T>) => Promise<T>;
}

export interface OpsSweepResult {
  readonly timeDriven: number;
  readonly deadMan: number;
  readonly sent: number;
  readonly failed: number;
  readonly suppressed: number;
  readonly reclaimed: number;
}

const withAdvisoryIncidentLock = async <T>(key: string, work: () => Promise<T>): Promise<T> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'ops-incident:' + key}))`);
    return work();
  });

export async function runOpsNotificationSweep(deps: OpsSweepDeps = {}): Promise<OpsSweepResult> {
  const store = deps.store ?? new DrizzleOpsNotificationStore(db);
  const mailer = deps.mailer ?? opsTemMailer;
  const recipients = deps.recipients ?? createOpsRecipientsPort();
  const clock = deps.clock ?? (() => new Date().toISOString());
  const policy = deps.policy ?? DEFAULT_OPS_NOTIFICATION_POLICY_V1;
  const withIncidentLock = deps.withIncidentLock ?? withAdvisoryIncidentLock;
  const result = { timeDriven: 0, deadMan: 0, sent: 0, failed: 0, suppressed: 0, reclaimed: 0 };
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
      await store.saveIncident(due.state);
      for (const kind of due.mails) {
        const rendered = renderOpsMail(kind, due.state);
        await store.insertDelivery({
          incidentId: due.state.key, targetKey: due.state.targetKey, kind,
          subject: rendered.subject, textBody: rendered.text, htmlBody: rendered.html,
        });
      }
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
      await store.saveIncident(stale);
      const rendered = renderOpsMail('firing', stale);
      await store.insertDelivery({
        incidentId: stale.key, targetKey: stale.targetKey, kind: 'firing',
        subject: rendered.subject, textBody: rendered.text, htmlBody: rendered.html,
      });
      result.deadMan += 1;
    });
  }

  const pending = await store.claimPendingDeliveries(OPS_SWEEP_CLAIM_LIMIT, nowIso);
  for (const delivery of pending) {
    try {
      if (delivery.attempts > OPS_SWEEP_MAX_SEND_ATTEMPTS) {
        await store.markDeliveryFailed(delivery.id, 'ops send attempts exceeded');
        result.failed += 1;
        continue;
      }
      const targets = await recipients.listRecipientsForTarget(delivery.targetKey);
      if (targets.length === 0) {
        await store.markDeliveryFailed(delivery.id, 'ops no usable recipient for target');
        result.failed += 1;
        continue;
      }
      const sentAt = await store.listRecentSentAt(
        delivery.targetKey, new Date(Date.parse(nowIso) - 60 * 60 * 1000).toISOString(),
      );
      if (isOpsMailCapExceeded(sentAt, nowIso, policy)) {
        await store.markDeliverySuppressed(delivery.id);
        result.suppressed += 1;
        continue;
      }
      let messageId = '';
      for (const recipient of targets) {
        const id = await mailer.send({
          to: recipient.email, subject: delivery.subject, text: delivery.textBody, html: delivery.htmlBody,
        });
        if (!messageId) messageId = id;
      }
      await store.markDeliverySent(delivery.id, messageId, targets, clock());
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'ops send failed';
      await store.markDeliveryFailed(delivery.id, message);
      result.failed += 1;
    }
  }
  return result;
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
