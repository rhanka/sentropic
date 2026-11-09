// Host ports for platform job-failure notifications (notify L1).
//
// The pure cluster-mesh machine decides; these ports are the host side:
// incident persistence, delivery rows, mail transport, outbox and clock.
// Tests inject fakes; production binds Postgres, TEM and the identity core.

import type {
  OpsIncidentMailV1,
  OpsIncidentStateV1,
} from '@sentropic/cluster-mesh/notifications';

export interface OpsDeliveryRecordV1 {
  readonly id: string;
  readonly incidentId: string;
  readonly targetKey: string;
  readonly kind: OpsIncidentMailV1;
  readonly status: 'pending' | 'sending' | 'sent' | 'failed' | 'suppressed';
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody: string;
  readonly recipients: readonly { readonly accountId: string; readonly email: string; readonly basis: string }[];
  readonly eventId: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly messageId: string | null;
  readonly sentAt: string | null;
}

export interface OpsNotificationStorePort {
  loadIncident(key: string): Promise<OpsIncidentStateV1 | null>;
  saveIncident(state: OpsIncidentStateV1): Promise<void>;
  /** Every firing incident (sweep: time-driven mails). */
  listFiringIncidents(): Promise<readonly OpsIncidentStateV1[]>;
  /** Dormant watches + resolved incidents with a heartbeat (sweep: dead-man). */
  listHeartbeatWatches(): Promise<readonly OpsIncidentStateV1[]>;
  insertDelivery(input: {
    readonly incidentId: string;
    readonly targetKey: string;
    readonly kind: OpsIncidentMailV1;
    readonly subject: string;
    readonly textBody: string;
    readonly htmlBody: string;
    readonly eventId?: string;
  }): Promise<OpsDeliveryRecordV1>;
  /** Atomically claim up to `limit` pending rows oldest-first. */
  claimPendingDeliveries(limit: number): Promise<readonly OpsDeliveryRecordV1[]>;
  /** Requeue `sending` rows older than the bound so a crashed sweep loses no mail. */
  reclaimStaleSending(staleBeforeIso: string): Promise<number>;
  markDeliverySent(id: string, messageId: string, recipients: OpsDeliveryRecordV1['recipients'], sentAt: string): Promise<void>;
  markDeliveryFailed(id: string, error: string): Promise<void>;
  markDeliverySuppressed(id: string): Promise<void>;
  /** Sent timestamps for the trailing-hour per-target cap. */
  listRecentSentAt(targetKey: string, sinceIso: string): Promise<readonly string[]>;
  hasSeenEvent(eventId: string): Promise<boolean>;
  recordSeenEvent(eventId: string, incidentId: string): Promise<void>;
}

export interface OpsMailerPort {
  /** Sends one rendered mail; resolves with the provider message id. */
  send(input: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html: string;
  }): Promise<string>;
}

export interface OpsOutboxPort {
  append(input: {
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly envelope: unknown;
    readonly tenantId?: string | null;
    readonly channel: string;
  }): Promise<void>;
}

export type OpsClockPort = () => string;
