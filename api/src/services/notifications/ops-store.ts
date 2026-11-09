// Postgres store for ops incidents and deliveries (notify L1).
//
// The pure cluster-mesh machine owns transitions; this store only persists
// them. Ingestion composes a tx-bound store so incident + seen-event +
// deliveries + outbox commit atomically; the sweep uses plain `db` with an
// advisory lock per incident (concurrent replicas serialize per key).

import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
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
import type { OpsDeliveryRecordV1, OpsNotificationStorePort } from './ops-types';

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
  lastMailAt: row.lastMailAt?.toISOString() ?? null,
  escalationLevel: row.escalationLevel === 1 ? 1 : 0,
  lastEscalationAt: row.lastEscalationAt?.toISOString() ?? null,
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
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
      lastMailAt: state.lastMailAt ? new Date(state.lastMailAt) : null,
      escalationLevel: state.escalationLevel,
      lastEscalationAt: state.lastEscalationAt ? new Date(state.lastEscalationAt) : null,
      resolvedAt: state.resolvedAt ? new Date(state.resolvedAt) : null,
      lastHeartbeatAt: state.lastHeartbeatAt ? new Date(state.lastHeartbeatAt) : null,
      updatedAt: new Date(),
    };
    const { id: _id, ...updatable } = values;
    await this.handle.insert(opsIncidents).values(values).onConflictDoUpdate({
      target: opsIncidents.id,
      set: updatable,
    });
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
    readonly kind: OpsDeliveryRecordV1['kind'];
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

  async claimPendingDeliveries(limit: number): Promise<readonly OpsDeliveryRecordV1[]> {
    const result = await this.handle.execute(sql`
      UPDATE control.ops_notification_deliveries AS d
      SET status = 'sending', attempts = d.attempts + 1, updated_at = now()
      WHERE d.id IN (
        SELECT id FROM control.ops_notification_deliveries
        WHERE status = 'pending' ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      RETURNING id, incident_id, target_key, kind, status, subject, text_body, html_body,
        recipients, event_id, attempts, last_error, message_id, sent_at
    `);
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{
      id: string; incident_id: string; target_key: string; kind: string; status: string;
      subject: string; text_body: string; html_body: string; recipients: unknown;
      event_id: string | null; attempts: number; last_error: string | null;
      message_id: string | null; sent_at: Date | string | null;
    }>;
    return rows.map((row) => ({
      id: row.id, incidentId: row.incident_id, targetKey: row.target_key,
      kind: row.kind as OpsDeliveryRecordV1['kind'], status: row.status as OpsDeliveryRecordV1['status'],
      subject: row.subject, textBody: row.text_body, htmlBody: row.html_body,
      recipients: (row.recipients ?? []) as OpsDeliveryRecordV1['recipients'],
      eventId: row.event_id, attempts: row.attempts, lastError: row.last_error,
      messageId: row.message_id,
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    }));
  }

  async markDeliverySent(
    id: string,
    messageId: string,
    recipients: OpsDeliveryRecordV1['recipients'],
    sentAt: string,
  ): Promise<void> {
    await this.handle.update(opsNotificationDeliveries).set({
      status: 'sent', messageId, recipients, sentAt: new Date(sentAt), lastError: null, updatedAt: new Date(),
    }).where(eq(opsNotificationDeliveries.id, id));
  }

  async markDeliveryFailed(id: string, error: string): Promise<void> {
    await this.handle.update(opsNotificationDeliveries).set({
      status: 'failed', lastError: error, updatedAt: new Date(),
    }).where(eq(opsNotificationDeliveries.id, id));
  }

  async markDeliverySuppressed(id: string): Promise<void> {
    await this.handle.update(opsNotificationDeliveries).set({
      status: 'suppressed', updatedAt: new Date(),
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

  async listRecentSentAt(targetKey: string, sinceIso: string): Promise<readonly string[]> {
    const rows = await this.handle.select({ sentAt: opsNotificationDeliveries.sentAt })
      .from(opsNotificationDeliveries)
      .where(and(
        eq(opsNotificationDeliveries.targetKey, targetKey),
        eq(opsNotificationDeliveries.status, 'sent'),
        gt(opsNotificationDeliveries.sentAt, new Date(sinceIso)),
      ));
    return rows.map((row) => row.sentAt!.toISOString());
  }

  async hasSeenEvent(eventId: string): Promise<boolean> {
    const rows = await this.handle.select({ eventId: opsSeenEvents.eventId })
      .from(opsSeenEvents).where(eq(opsSeenEvents.eventId, eventId)).limit(1);
    return rows.length > 0;
  }

  async recordSeenEvent(eventId: string, incidentId: string): Promise<void> {
    await this.handle.insert(opsSeenEvents).values({ eventId, incidentId }).onConflictDoNothing();
  }
}
