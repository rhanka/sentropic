// Ingestion orchestration for OpsJobFailureV1 events (notify L1).
//
// One call = validate-then-apply-then-persist: replayed `eventId`s are
// no-ops (no incident write, no mail), otherwise the pure machine decides
// and the store + outbox persist in the caller's transaction. Pure except
// for the injected ports, so unit tests run on fakes.

import { sql } from 'drizzle-orm';
import {
  applyOpsJobFailureEvent,
  opsIncidentKey,
  type OpsIncidentMailV1,
  type OpsIncidentStateV1,
  type OpsJobFailureV1,
} from '@sentropic/cluster-mesh/notifications';
import { db } from '../../db/client';
import { outboxWriter } from '../outbox/outbox-writer';
import { renderOpsMail, type OpsRenderedMailV1 } from './ops-mail';
import { DrizzleOpsNotificationStore } from './ops-store';
import type { OpsClockPort, OpsNotificationStorePort, OpsOutboxPort } from './ops-types';

export interface OpsIngestDeps {
  readonly store: OpsNotificationStorePort;
  readonly outbox: OpsOutboxPort;
  readonly clock: OpsClockPort;
  readonly renderMail?: (kind: OpsIncidentMailV1, state: OpsIncidentStateV1) => OpsRenderedMailV1;
}

export interface OpsIngestResult {
  readonly incidentKey: string;
  readonly status: 'firing' | 'resolved';
  readonly mails: readonly OpsIncidentMailV1[];
  readonly deduped: boolean;
}

/** Aggregate identity for the durable outbox trace of every ingestion. */
export const OPS_INCIDENT_AGGREGATE_TYPE = 'ops_incident';
export const OPS_INCIDENT_OUTBOX_CHANNEL = 'ops_incident_events';

export async function ingestOpsJobFailureEvent(
  deps: OpsIngestDeps,
  event: OpsJobFailureV1,
): Promise<OpsIngestResult> {
  const { store, outbox, clock } = deps;
  const render = deps.renderMail ?? renderOpsMail;
  const incidentKey = opsIncidentKey(event.targetKey, event.jobRef.namespace, event.jobRef.name);
  if (await store.hasSeenEvent(event.eventId)) {
    const existing = await store.loadIncident(incidentKey);
    return { incidentKey, status: existing?.status ?? 'resolved', mails: [], deduped: true };
  }
  const nowIso = clock();
  const transition = applyOpsJobFailureEvent(await store.loadIncident(incidentKey), event, nowIso);
  const state = transition.state;
  const status = state?.status ?? 'resolved';
  if (state) await store.saveIncident(state);
  await store.recordSeenEvent(event.eventId, incidentKey);
  for (const kind of transition.mails) {
    if (!state) continue;
    const rendered = render(kind, state);
    await store.insertDelivery({
      incidentId: incidentKey, targetKey: event.targetKey, kind,
      subject: rendered.subject, textBody: rendered.text, htmlBody: rendered.html,
      eventId: event.eventId,
    });
  }
  await outbox.append({
    aggregateType: OPS_INCIDENT_AGGREGATE_TYPE,
    aggregateId: incidentKey,
    envelope: { type: 'ops.job_failure.ingested', incidentKey, eventId: event.eventId, mails: transition.mails },
    channel: OPS_INCIDENT_OUTBOX_CHANNEL,
  });
  return { incidentKey, status, mails: transition.mails, deduped: false };
}

/**
 * Production composer: incident + seen-event + deliveries + outbox commit
 * atomically. A tx-scoped advisory lock on the eventId serializes concurrent
 * duplicate ingests (k8s watcher and app webhook reporting the same run), so
 * the second one replays as deduped instead of double-mailing.
 */
export async function ingestOpsJobFailureEventTx(event: OpsJobFailureV1): Promise<OpsIngestResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'ops-seen:' + event.eventId}))`);
    return ingestOpsJobFailureEvent({
      store: new DrizzleOpsNotificationStore(tx),
      outbox: {
        append: async (input) => {
          await outboxWriter.append(tx, {
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            envelope: input.envelope,
            tenantId: input.tenantId ?? null,
            workspaceId: null,
            channel: input.channel,
          });
        },
      },
      clock: () => new Date().toISOString(),
    }, event);
  });
}
