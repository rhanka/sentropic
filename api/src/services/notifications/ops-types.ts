// Host ports for platform job-failure notifications (notify L1).
//
// The pure cluster-mesh machine decides; these ports are the host side:
// incident persistence, delivery rows, mail transport, outbox and clock.
// Tests inject fakes; production binds Postgres, TEM and the identity core.

import type {
  OpsIncidentMailV1,
  OpsIncidentStateV1,
} from '@sentropic/cluster-mesh/notifications';

/** Alert mails the machine requests, plus host-side configuration alerts. */
export type OpsDeliveryKindV1 = OpsIncidentMailV1 | 'config';

export interface OpsDeliveryRecordV1 {
  readonly id: string;
  readonly incidentId: string;
  readonly targetKey: string;
  readonly kind: OpsDeliveryKindV1;
  readonly status: 'pending' | 'sending' | 'sent' | 'failed' | 'suppressed';
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody: string;
  readonly recipients: readonly { readonly accountId: string; readonly email: string; readonly basis: string; readonly messageId?: string }[];
  readonly eventId: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly messageId: string | null;
  readonly sentAt: string | null;
  readonly nextAttemptAt: string | null;
}

export interface OpsSeenEventV1 {
  readonly eventId: string;
  readonly incidentId: string;
  readonly payloadSha256: string;
  readonly canonicalKey: string;
}

export interface OpsNotificationStorePort {
  loadIncident(key: string): Promise<OpsIncidentStateV1 | null>;
  saveIncident(state: OpsIncidentStateV1): Promise<void>;
  /** Every firing incident (sweep: time-driven mails). */
  listFiringIncidents(): Promise<readonly OpsIncidentStateV1[]>;
  /** Dormant watches + resolved incidents with a heartbeat (sweep: dead-man). */
  listHeartbeatWatches(): Promise<readonly OpsIncidentStateV1[]>;
  /** Records the actual send time so the digest clock tracks reality. */
  touchIncidentMailAt(incidentKey: string, sentAtIso: string): Promise<void>;
  insertDelivery(input: {
    readonly incidentId: string;
    readonly targetKey: string;
    readonly kind: OpsDeliveryKindV1;
    readonly subject: string;
    readonly textBody: string;
    readonly htmlBody: string;
    readonly eventId?: string;
  }): Promise<OpsDeliveryRecordV1>;
  /** Atomically claims up to `limit` pending rows whose next attempt is due, oldest-first. */
  claimPendingDeliveries(limit: number, nowIso: string): Promise<readonly OpsDeliveryRecordV1[]>;
  /** Requeue stuck `sending` rows older than the bound so a crash loses no mail. */
  reclaimStaleSending(staleBeforeIso: string): Promise<number>;
  markDeliverySent(
    id: string,
    messageId: string,
    recipients: OpsDeliveryRecordV1['recipients'],
    sentAt: string,
  ): Promise<void>;
  /** One recipient served: persisted immediately so a crash cannot resend it. */
  markDeliveryRecipientSent(
    id: string,
    recipient: { readonly accountId: string; readonly email: string; readonly basis: string; readonly messageId: string },
  ): Promise<void>;
  /** Terminal failure: retried attempts exhausted or permanent provider error. */
  markDeliveryFailed(id: string, error: string): Promise<void>;
  /** @deprecated Cap-suppressed is requeued with a backoff since the sweep rewrite; kept for the old sweep. */
  markDeliverySuppressed(id: string): Promise<void>;
  /** @deprecated Replaced by listRecentSentMailCounts; kept for the old sweep. */
  listRecentSentAt(targetKey: string, sinceIso: string): Promise<readonly string[]>;
  /** Transient failure or cap: stays pending with a backoff, retried by the next sweep. */
  markDeliveryRetryable(id: string, error: string, nextAttemptAtIso: string): Promise<void>;
  /** Recipient-weighted sent mail counts per target since `sinceIso`. */
  listRecentSentMailCounts(sinceIso: string): Promise<readonly { readonly targetKey: string; readonly mails: number }[]>;
  /** Recipient-weighted sent mails to one address since `sinceIso`. */
  countRecentSentTo(email: string, sinceIso: string): Promise<number>;
  loadSeenEvent(eventId: string): Promise<OpsSeenEventV1 | null>;
  findSeenCanonical(canonicalKey: string): Promise<OpsSeenEventV1 | null>;
  /** True when a pending or sending delivery of this kind already exists. */
  hasUnsentDelivery(incidentId: string, kind: OpsDeliveryKindV1): Promise<boolean>;
  recordSeenEvent(input: {
    readonly eventId: string;
    readonly incidentId: string;
    readonly payloadSha256: string;
    readonly canonicalKey: string;
  }): Promise<void>;
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
