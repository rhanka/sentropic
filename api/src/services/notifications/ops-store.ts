// Postgres store for ops incidents and deliveries (notify L1).
//
// The pure cluster-mesh machine owns transitions; this store only persists
// them. Ingestion composes a tx-bound store so incident + seen-event +
// deliveries + outbox commit atomically; the sweep uses plain `db` with an
// advisory lock per incident (concurrent replicas serialize per key).

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  type OpsIncidentStateV1,
  type OpsIncidentStatusV1,
} from '@sentropic/cluster-mesh/notifications';
import { db } from '../../db/client';
import {
  opsIncidents,
  opsNotificationDeliveries,
  opsSeenEvents,
  type OpsIncidentRow,
  type OpsNotificationDeliveryRow,
} from '../../db/control-schema';
import { createId } from '../../utils/id';
import type { OpsDeliveryKindV1, OpsDeliveryRecordV1, OpsNotificationStorePort, OpsSeenEventV1 } from './ops-types';

/** Query-builder surface the store needs; both `db` and a tx satisfy it. */
export type OpsDrizzleHandle = Pick<NodePgDatabase, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

const toState = (row: OpsIncidentRow): OpsIncidentStateV1 => ({
  key: row.id,
  targetKey: row.targetKey,
  jobNamespace: row.jobNamespace.length > 0 ? row.jobNamespace : null,
  jobName: row.jobName,
  jobKind: row.jobKind as OpsIncidentStateV1['jobKind'],
  status: row.status as OpsIncidentStatusV1,
  firstSeenAt: row.firstSeenAt.toISOString(),
  lastSeenAt: row.lastSeenAt.toISOString(),
  occurrenceCount: row.occurrenceCount,
  consecutiveFailures: row.consecutiveFailures,
  lastReason: (row.lastReason ?? null) as OpsIncidentStateV1['lastReason'],
  lastSeverity: (row.lastSeverity ?? null) as OpsIncidentStateV1['lastSeverity'],
  lastRunId: row.lastRunId,
  lastEventId: row.lastEventId,
  lastLinks: (row.lastLinks ?? null) as OpsIncidentStateV1['lastLinks'],
  lastDetail: row.lastDetail,
  lastMailAt: row.lastMailAt?.toISOString() ?? null,
  escalationLevel: row.escalationLevel === 1 ? 1 : 0,
  lastEscalationAt: row.lastEscalationAt?.toISOString() ?? null,
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
  lastOccurredAt: row.lastOccurredAt?.toISOString() ?? null,
});

const toDelivery = (row: OpsNotificationDeliveryRow): OpsDeliveryRecordV1 => ({
  id: row.id,
  incidentId: row.incidentId,
  targetKey: row.targetKey,
  kind: row.kind as OpsDeliveryRecordV1['kind'],
  status: row.status as OpsDeliveryRecordV1['status'],
  subject: row.subject,
  textBody: row.textBody,
  htmlBody: row.htmlBody,
  recipients: (row.recipients ?? []) as OpsDeliveryRecordV1['recipients'],
  eventId: row.eventId,
  attempts: row.attempts,
  lastError: row.lastError,
  messageId: row.messageId,
  sentAt: row.sentAt?.toISOString() ?? null,
  nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
});

export class DrizzleOpsNotificationStore implements OpsNotificationStorePort {
  constructor(private readonly handle: OpsDrizzleHandle = db) {}

  async loadIncident(key: string): Promise<OpsIncidentStateV1 | null> {
    const rows = await this.handle.select().from(opsIncidents).where(eq(opsIncidents.id, key)).limit(1);
    return rows.length > 0 ? toState(rows[0]!) : null;
  }

  async saveIncident(state: OpsIncidentStateV1): Promise<void> {
    const values = {
      id: state.key,
      targetKey: state.targetKey,
      jobNamespace: state.jobNamespace ?? '',
      jobName: state.jobName,
      jobKind: state.jobKind,
      status: state.status,
      firstSeenAt: new Date(state.firstSeenAt),
      lastSeenAt: new Date(state.lastSeenAt),
      occurrenceCount: state.occurrenceCount,
      consecutiveFailures: state.consecutiveFailures,
      lastReason: state.lastReason,
      lastSeverity: state.lastSeverity,
      lastRunId: state.lastRunId,
      lastEventId: state.lastEventId,
      lastLinks: state.lastLinks,
      lastDetail: state.lastDetail,
      lastMailAt: state.lastMailAt ? new Date(state.lastMailAt) : null,
      escalationLevel: state.escalationLevel,
      lastEscalationAt: state.lastEscalationAt ? new Date(state.lastEscalationAt) : null,
      resolvedAt: state.resolvedAt ? new Date(state.resolvedAt) : null,
      lastHeartbeatAt: state.lastHeartbeatAt ? new Date(state.lastHeartbeatAt) : null,
      lastOccurredAt: state.lastOccurredAt ? new Date(state.lastOccurredAt) : null,
      updatedAt: new Date(),
    };
    const { id: _id, ...updatable } = values;
    await this.handle.insert(opsIncidents).values(values).onConflictDoUpdate({
      target: opsIncidents.id,
      set: updatable,
    });
  }

  async touchIncidentMailAt(incidentKey: string, sentAtIso: string): Promise<void> {
    await this.handle.update(opsIncidents).set({
      lastMailAt: new Date(sentAtIso), updatedAt: new Date(),
    }).where(eq(opsIncidents.id, incidentKey));
  }

  async saveIncidentWithDeliveries(
    state: OpsIncidentStateV1,
    deliveries: readonly {
      readonly incidentId: string;
      readonly targetKey: string;
      readonly kind: OpsDeliveryKindV1;
      readonly subject: string;
      readonly textBody: string;
      readonly htmlBody: string;
    }[],
  ): Promise<void> {
    const run = async (handle: OpsDrizzleHandle): Promise<void> => {
      const scoped = new DrizzleOpsNotificationStore(handle);
      await scoped.saveIncident(state);
      for (const delivery of deliveries) {
        await scoped.insertDelivery(delivery);
      }
    };
    if (this.handle === db) {
      await db.transaction(async (tx) => run(tx));
      return;
    }
    await run(this.handle);
  }

  async markDeliveryCapDelayed(id: string, error: string, nextAttemptAtIso: string): Promise<void> {
    await this.handle.update(opsNotificationDeliveries).set({
      status: 'pending', lastError: error,
      nextAttemptAt: new Date(nextAttemptAtIso), updatedAt: new Date(),
      attempts: sql`GREATEST(${opsNotificationDeliveries.attempts} - 1, 0)`,
    }).where(eq(opsNotificationDeliveries.id, id));
  }

  async listFiringIncidents(): Promise<readonly OpsIncidentStateV1[]> {
    const rows = await this.handle.select().from(opsIncidents).where(eq(opsIncidents.status, 'firing'));
    return rows.map(toState);
  }

  async listHeartbeatWatches(): Promise<readonly OpsIncidentStateV1[]> {
    const rows = await this.handle.select().from(opsIncidents).where(
      and(eq(opsIncidents.status, 'resolved'), isNotNull(opsIncidents.lastHeartbeatAt)),
    );
    return rows.map(toState);
  }

  async insertDelivery(input: {
    readonly incidentId: string;
    readonly targetKey: string;
    readonly kind: OpsDeliveryKindV1;
    readonly subject: string;
    readonly textBody: string;
    readonly htmlBody: string;
    readonly eventId?: string;
  }): Promise<OpsDeliveryRecordV1> {
    const rows = await this.handle.insert(opsNotificationDeliveries).values({
      id: createId(),
      incidentId: input.incidentId,
      targetKey: input.targetKey,
      kind: input.kind,
      status: 'pending',
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      recipients: [],
      eventId: input.eventId ?? null,
    }).returning();
    return toDelivery(rows[0]!);
  }

  async claimPendingDeliveries(limit: number, nowIso: string): Promise<readonly OpsDeliveryRecordV1[]> {
    const result = await this.handle.execute(sql`
      UPDATE control.ops_notification_deliveries AS d
      SET status = 'sending', attempts = d.attempts + 1, updated_at = now()
      WHERE d.id IN (
        SELECT id FROM control.ops_notification_deliveries
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${nowIso}::timestamptz)
        ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      RETURNING id, incident_id, target_key, kind, status, subject, text_body, html_body,
        recipients, event_id, attempts, last_error, message_id, sent_at, next_attempt_at
    `);
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string; incident_id: string; target_key: string; kind: string; status: string;
      subject: string; text_body: string; html_body: string; recipients: unknown;
      event_id: string | null; attempts: number; last_error: string | null;
      message_id: string | null; sent_at: Date | string | null;
      next_attempt_at: Date | string | null;
    }>;
    return rows.map((row) => ({
      id: row.id, incidentId: row.incident_id, targetKey: row.target_key,
      kind: row.kind as OpsDeliveryRecordV1['kind'], status: row.status as OpsDeliveryRecordV1['status'],
      subject: row.subject, textBody: row.text_body, htmlBody: row.html_body,
      recipients: (row.recipients ?? []) as OpsDeliveryRecordV1['recipients'],
      eventId: row.event_id, attempts: row.attempts, lastError: row.last_error,
      messageId: row.message_id,
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
      nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
    }));
  }

  async markDeliverySent(
    id: string,
    messageId: string,
    recipients: OpsDeliveryRecordV1['recipients'],
    sentAt: string,
  ): Promise<void> {
    await this.handle.update(opsNotificationDeliveries).set({
      status: 'sent', messageId, recipients, sentAt: new Date(sentAt),
      lastError: null, nextAttemptAt: null, updatedAt: new Date(),
    }).where(eq(opsNotificationDeliveries.id, id));
  }

  async markDeliveryRecipientSent(
    id: string,
    recipient: { readonly accountId: string; readonly email: string; readonly basis: string; readonly messageId: string },
  ): Promise<void> {
    const rows = await this.handle.select({ recipients: opsNotificationDeliveries.recipients })
      .from(opsNotificationDeliveries).where(eq(opsNotificationDeliveries.id, id)).limit(1);
    const current = (rows[0]?.recipients ?? []) as OpsDeliveryRecordV1['recipients'];
    if (current.some((entry) => entry.email === recipient.email)) return;
    await this.handle.update(opsNotificationDeliveries).set({
      recipients: [...current, recipient], updatedAt: new Date(),
    }).where(eq(opsNotificationDeliveries.id, id));
  }

  async markDeliveryFailed(id: string, error: string): Promise<void> {
    await this.handle.update(opsNotificationDeliveries).set({
      status: 'failed', lastError: error, nextAttemptAt: null, updatedAt: new Date(),
    }).where(eq(opsNotificationDeliveries.id, id));
  }

  async markDeliveryRetryable(id: string, error: string, nextAttemptAtIso: string): Promise<void> {
    await this.handle.update(opsNotificationDeliveries).set({
      status: 'pending', lastError: error,
      nextAttemptAt: new Date(nextAttemptAtIso), updatedAt: new Date(),
    }).where(eq(opsNotificationDeliveries.id, id));
  }

  /** Requeue `sending` rows stuck by a crashed sweep so mail is never lost. */
  async reclaimStaleSending(staleBeforeIso: string): Promise<number> {
    const result = await this.handle.execute(sql`
      UPDATE control.ops_notification_deliveries
      SET status = 'pending', updated_at = now()
      WHERE status = 'sending' AND updated_at < ${staleBeforeIso}::timestamptz
    `);
    const count = (result as { rowCount?: unknown }).rowCount;
    return typeof count === 'number' ? count : 0;
  }

    /** 90-day retention purge: terminal deliveries and seen events only, never pending work. */
  async purgeExpiredOpsData(cutoffIso: string): Promise<{ readonly deliveries: number; readonly seenEvents: number }> {
    const countOf = (result: unknown): number => {
      const rowCount = (result as { rowCount?: unknown }).rowCount;
      return typeof rowCount === 'number' ? rowCount : 0;
    };
    const deletedDeliveries = await this.handle.execute(sql`
      DELETE FROM control.ops_notification_deliveries
      WHERE created_at < ${cutoffIso}::timestamptz AND status IN ('sent', 'failed')
    `);
    const deletedSeen = await this.handle.execute(sql`
      DELETE FROM control.ops_seen_events WHERE received_at < ${cutoffIso}::timestamptz
    `);
    return { deliveries: countOf(deletedDeliveries), seenEvents: countOf(deletedSeen) };
  }

  /**
   * Recipient-weighted sent mail counts per target (one delivery = N mails).
   *
   * Counts closed sends (`sent`, windowed by `sent_at`) AND already-served
   * recipients on open or failed rows (windowed by `updated_at`, which every
   * serve/fail/retry bumps): a partial batch persisted by
   * `markDeliveryRecipientSent` and requeued by the cap path must still
   * consume the hourly budget, otherwise a second delivery in the same sweep
   * or the retry after the cap backoff would send a fresh tranche.
   */
  async listRecentSentMailCounts(sinceIso: string): Promise<readonly { readonly targetKey: string; readonly mails: number }[]> {
    const result = await this.handle.execute(sql`
      SELECT target_key, COALESCE(SUM(jsonb_array_length(recipients)), 0)::int AS mails
      FROM control.ops_notification_deliveries
      WHERE jsonb_array_length(recipients) > 0
        AND (
          (status = 'sent' AND sent_at > ${sinceIso}::timestamptz)
          OR (status IN ('pending', 'sending', 'failed') AND updated_at > ${sinceIso}::timestamptz)
        )
      GROUP BY target_key
    `);
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{
      target_key: string; mails: string | number;
    }>;
    return rows.map((row) => ({ targetKey: row.target_key, mails: Number(row.mails) }));
  }

  async countPendingForTarget(targetKey: string): Promise<number> {
    const rows = await this.handle.select({ id: opsNotificationDeliveries.id })
      .from(opsNotificationDeliveries)
      .where(and(
        eq(opsNotificationDeliveries.targetKey, targetKey),
        sql`${opsNotificationDeliveries.status} IN ('pending', 'sending')`,
      ));
    return rows.length;
  }

  /**
   * Recipient-weighted sends to one address: closed sends windowed by
   * `sent_at`, plus already-served entries on open or failed rows windowed
   * by `updated_at` (same partial-progress ledger as
   * `listRecentSentMailCounts`, so the per-address ceiling holds across
   * sweeps and across deliveries of one sweep).
   */
  async countRecentSentTo(email: string, sinceIso: string): Promise<number> {
    const result = await this.handle.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM control.ops_notification_deliveries
      WHERE recipients @> jsonb_build_array(jsonb_build_object('email', ${email}))
        AND (
          (status = 'sent' AND sent_at > ${sinceIso}::timestamptz)
          OR (status IN ('pending', 'sending', 'failed') AND updated_at > ${sinceIso}::timestamptz)
        )
    `);
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{
      count: string | number;
    }>;
    return rows.length > 0 ? Number(rows[0]!.count) : 0;
  }

  async loadSeenEvent(eventId: string): Promise<OpsSeenEventV1 | null> {
    const rows = await this.handle.select().from(opsSeenEvents).where(eq(opsSeenEvents.eventId, eventId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      eventId: row.eventId, incidentId: row.incidentId,
      payloadSha256: row.payloadSha256, canonicalKey: row.canonicalKey,
    };
  }

  async hasUnsentDelivery(incidentId: string, kind: OpsDeliveryKindV1): Promise<boolean> {
    const rows = await this.handle.select({ id: opsNotificationDeliveries.id })
      .from(opsNotificationDeliveries)
      .where(and(
        eq(opsNotificationDeliveries.incidentId, incidentId),
        eq(opsNotificationDeliveries.kind, kind),
        sql`${opsNotificationDeliveries.status} IN ('pending', 'sending')`,
      )).limit(1);
    return rows.length > 0;
  }

  async findSeenCanonical(canonicalKey: string): Promise<OpsSeenEventV1 | null> {
    const rows = await this.handle.select().from(opsSeenEvents)
      .where(eq(opsSeenEvents.canonicalKey, canonicalKey)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      eventId: row.eventId, incidentId: row.incidentId,
      payloadSha256: row.payloadSha256, canonicalKey: row.canonicalKey,
    };
  }

  async recordSeenEvent(input: {
    readonly eventId: string;
    readonly incidentId: string;
    readonly payloadSha256: string;
    readonly canonicalKey: string;
  }): Promise<void> {
    await this.handle.insert(opsSeenEvents).values({
      eventId: input.eventId,
      incidentId: input.incidentId,
      payloadSha256: input.payloadSha256,
      canonicalKey: input.canonicalKey,
    }).onConflictDoNothing();
  }
}
