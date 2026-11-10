// Ingestion orchestration for OpsJobFailureV1 events (notify L1).
//
// One call = validate-then-apply-then-persist: strict replays are no-ops, the
// same `eventId` with different bytes is a 409 conflict, the same run
// reported by a second source (k8s watcher + app) is a cross-source duplicate
// that opens no incident and queues no mail, and events older than the
// incident are stale replays. Otherwise the pure machine decides and the
// store + outbox persist in the caller's transaction. Pure except for the
// injected ports, so unit tests run on fakes.

import { sql } from 'drizzle-orm';
import {
  applyOpsJobFailureEvent,
  fingerprintOpsJobFailureEvent,
  opsCanonicalRunKey,
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
  /** Authenticated service-client id, traced in the outbox envelope. */
  readonly ingestedBy?: string;
}

export interface OpsIngestResult {
  readonly incidentKey: string;
  readonly status: 'firing' | 'resolved';
  readonly mails: readonly OpsIncidentMailV1[];
  readonly deduped: boolean;
  readonly stale: boolean;
  readonly conflict: boolean;
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
  const canonicalKey = opsCanonicalRunKey(
    event.targetKey, event.jobRef.namespace, event.jobRef.name, event.runId, event.outcome,
  );
  const payloadSha256 = fingerprintOpsJobFailureEvent(event);

  const seen = await store.loadSeenEvent(event.eventId);
  if (seen) {
    // Same id, different bytes: the emitter reused an idempotence key for a
    // different event. Never collapse it into a silent dedup.
    if (seen.payloadSha256 !== payloadSha256) {
      return { incidentKey, status: 'firing', mails: [], deduped: false, stale: false, conflict: true };
    }
    const existing = await store.loadIncident(incidentKey);
    return { incidentKey, status: existing?.status ?? 'resolved', mails: [], deduped: true, stale: false, conflict: false };
  }
  const canonical = await store.findSeenCanonical(canonicalKey);
  if (canonical && canonical.eventId !== event.eventId) {
    // Same execution already reported by the other source: record this
    // eventId so its own replays stay cheap, change nothing else.
    await store.recordSeenEvent({ eventId: event.eventId, incidentId: canonical.incidentId, payloadSha256, canonicalKey });
    const existing = await store.loadIncident(canonical.incidentId);
    return {
      incidentKey: canonical.incidentId, status: existing?.status ?? 'resolved',
      mails: [], deduped: true, stale: false, conflict: false,
    };
  }

  const nowIso = clock();
  const transition = applyOpsJobFailureEvent(await store.loadIncident(incidentKey), event, nowIso);
  const state = transition.state;
  const status = state?.status ?? 'resolved';
  if (state && !transition.stale) await store.saveIncident(state);
  await store.recordSeenEvent({ eventId: event.eventId, incidentId: incidentKey, payloadSha256, canonicalKey });
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
    envelope: {
      type: 'ops.job_failure.ingested', incidentKey, eventId: event.eventId,
      mails: transition.mails, stale: transition.stale, deduped: false,
      ingestedBy: deps.ingestedBy ?? null, payloadSha256,
    },
    channel: OPS_INCIDENT_OUTBOX_CHANNEL,
  });
  return { incidentKey, status, mails: transition.mails, deduped: false, stale: transition.stale, conflict: false };
}

/**
 * Production composer: incident + seen-event + deliveries + outbox commit
 * atomically. A tx-scoped advisory lock on the INCIDENT serializes concurrent
 * duplicate ingests and concurrent sweeps (same `ops-incident:` domain the
 * sweep uses), so two first events for one incident cannot double-open it
 * and a sweep cannot interleave a time-driven mail mid-ingest. The eventId
 * lock serializes strict replay races on top.
 */
export async function ingestOpsJobFailureEventTx(
  event: OpsJobFailureV1,
  options: { readonly ingestedBy?: string } = {},
): Promise<OpsIngestResult> {
  const incidentKey = opsIncidentKey(event.targetKey, event.jobRef.namespace, event.jobRef.name);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'ops-incident:' + incidentKey}))`);
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
      ingestedBy: options.ingestedBy,
    }, event);
  });
}
