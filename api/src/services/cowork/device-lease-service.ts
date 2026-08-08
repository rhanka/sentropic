import { createHash } from 'node:crypto';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';

import { db, pool } from '../../db/client';
import { coworkDeviceLeases, coworkDevices } from '../../db/schema';
import { findActiveCoworkDevice, verifyCoworkSignature } from './device-identity';
import { isCoworkInputAction } from './input-action-schema';
import { COWORK_KIOSK_SURFACE } from './provisioning';
import { signLeaseEnvelope, type ServerSignedLeaseEnvelope } from './lease-envelope';

const LEASE_TTL_MS = 45_000;
const PRESENCE_FRESHNESS_MS = 45_000;
const IN_FLIGHT_STATUSES = ['issued', 'acknowledged'] as const;

export type LeaseScope = {
  capability: 'screen_capture' | 'input_action';
  serverEnvelope: ServerSignedLeaseEnvelope;
  /** Delivered to the device for foreground consent; never emitted to audit. */
  action?: Record<string, unknown>;
  /** Durable idempotency binding; never sourced from a mutable mount field. */
  invocation?: CoworkInvocationBinding;
} | null;
export type LeaseIssueScope = {
  capability: 'screen_capture' | 'input_action';
  action?: Record<string, unknown>;
} | null;
type LeaseStatus = 'issued' | 'acknowledged' | 'consumed' | 'expired' | 'revoked';

export type CoworkInvocationBinding = {
  principalId: string;
  workspaceId: string;
  sessionId: string;
  targetDeviceId: string;
  capability: 'screen_capture' | 'input_action';
  actionHash: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function coworkActionHash(action: Record<string, unknown> | undefined): string {
  return createHash('sha256').update(canonicalJson(action ?? {})).digest('base64url');
}

function hasBinding(scope: LeaseScope, expected: CoworkInvocationBinding): boolean {
  if (!scope || typeof scope !== 'object') return false;
  const binding = (scope as LeaseScope & { invocation?: unknown }).invocation;
  return canonicalJson(binding) === canonicalJson(expected);
}

export type LeaseResult =
  | { ok: true; lease: { leaseId: string; deviceId: string; nonce: string; scope: LeaseScope; expiresAt: Date; status: LeaseStatus } }
  | { ok: false; reason: 'ineligible' | 'not_found' | 'invalid_signature' | 'not_issuable' | 'not_revocable' };

const toLease = (lease: typeof coworkDeviceLeases.$inferSelect) => ({
  leaseId: lease.id,
  deviceId: lease.deviceId,
  nonce: lease.nonce,
  scope: lease.scope as LeaseScope,
  expiresAt: lease.expiresAt,
  status: lease.status as LeaseStatus,
});

async function publishLeaseNotification(deviceId: string): Promise<void> {
  // Durable rows are the queue. This low-latency signal is intentionally best-effort.
  await pool.query('SELECT pg_notify($1, $2)', ['cowork_device_lease_events', JSON.stringify({ device_id: deviceId })]);
}

export async function issueLease(input: {
  userId: string;
  deviceId: string;
  turnRef: string;
  workspaceId: string;
  sessionId: string;
  scope: LeaseIssueScope;
}): Promise<LeaseResult> {
  // C5a: no server-signed executable lease exists outside the isolated benign
  // kiosk MVP.  This is the authoritative Option-B safety boundary.
  if (process.env.NODE_ENV === 'production') return { ok: false, reason: 'not_issuable' };
  const requestedCapability = input.scope?.capability;
  if (requestedCapability !== 'screen_capture' && requestedCapability !== 'input_action') {
    return { ok: false, reason: 'not_issuable' };
  }
  if (requestedCapability === 'input_action' && !isCoworkInputAction(input.scope?.action)) {
    return { ok: false, reason: 'not_issuable' };
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);
  const leaseId = crypto.randomUUID();
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const invocation: CoworkInvocationBinding = {
    principalId: input.userId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    targetDeviceId: input.deviceId,
    capability: requestedCapability,
    actionHash: coworkActionHash(input.scope?.action),
  };
  let envelope: ServerSignedLeaseEnvelope;
  try {
    envelope = await signLeaseEnvelope({
      leaseId,
      capability: requestedCapability,
      targetDeviceId: input.deviceId,
      nonce,
      expiry: expiresAt.toISOString(),
    });
  } catch {
    return { ok: false, reason: 'not_issuable' };
  }

  const result = await db.transaction(async (tx) => {
    await tx
      .update(coworkDeviceLeases)
      .set({ status: 'expired' })
      .where(and(
        eq(coworkDeviceLeases.deviceId, input.deviceId),
        eq(coworkDeviceLeases.turnRef, input.turnRef),
        eq(coworkDeviceLeases.status, 'issued'),
        lte(coworkDeviceLeases.expiresAt, now),
      ));
    // Lock the device while checking presence and inserting the lease. A
    // concurrent revoke waits for this transaction rather than slipping between
    // eligibility and issuance.
    const eligibility = await tx.execute(sql`
      SELECT d.id
      FROM cowork_devices d
      JOIN cowork_device_presence p ON p.device_id = d.id
      JOIN cowork_device_provisioning kp ON kp.public_key = d.public_key
      JOIN cowork_device_exposure_grants g ON g.device_id = d.id
      WHERE d.id = ${input.deviceId}
        AND d.user_id = ${input.userId}
        AND d.status = 'active'
        AND p.user_id = ${input.userId}
        AND p.status = 'active'
        AND p.last_seen_at > ${new Date(now.getTime() - PRESENCE_FRESHNESS_MS)}
        AND kp.status = 'active'
        AND kp.kiosk_surface = ${COWORK_KIOSK_SURFACE}
        AND kp.capability_ids @> ${JSON.stringify(['screen_capture', 'input_action'])}::jsonb
        AND g.workspace_id = ${input.workspaceId}
        AND g.capability = ${requestedCapability}
      FOR UPDATE OF d
    `);
    if (eligibility.rows.length === 0) {
      return { ok: false, reason: 'ineligible' } as LeaseResult;
    }

    const [existing] = await tx
      .select()
      .from(coworkDeviceLeases)
      .where(and(
        eq(coworkDeviceLeases.deviceId, input.deviceId),
        eq(coworkDeviceLeases.turnRef, input.turnRef),
        inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES),
      ))
      .limit(1);
    if (existing) {
      if (hasBinding(existing.scope as LeaseScope, invocation)) return { ok: true, lease: toLease(existing) } as LeaseResult;
      await tx.update(coworkDeviceLeases).set({ status: 'revoked' }).where(and(
        eq(coworkDeviceLeases.id, existing.id),
        inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES),
      ));
      return { ok: false, reason: 'not_issuable' } as LeaseResult;
    }

    const [lease] = await tx
      .insert(coworkDeviceLeases)
      .values({
        id: leaseId,
        deviceId: input.deviceId,
        userId: input.userId,
        turnRef: input.turnRef,
        nonce,
        scope: {
          capability: requestedCapability,
          serverEnvelope: envelope,
          invocation,
          ...(input.scope?.action ? { action: input.scope.action } : {}),
        },
        status: 'issued',
        issuedAt: now,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning();
    if (lease) return { ok: true, lease: toLease(lease) } as LeaseResult;

    const [raced] = await tx
      .select()
      .from(coworkDeviceLeases)
      .where(and(
        eq(coworkDeviceLeases.deviceId, input.deviceId),
        eq(coworkDeviceLeases.turnRef, input.turnRef),
        inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES),
      ))
      .limit(1);
    if (!raced) return { ok: false, reason: 'ineligible' } as LeaseResult;
    if (hasBinding(raced.scope as LeaseScope, invocation)) return { ok: true, lease: toLease(raced) } as LeaseResult;
    await tx.update(coworkDeviceLeases).set({ status: 'revoked' }).where(and(
      eq(coworkDeviceLeases.id, raced.id),
      inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES),
    ));
    return { ok: false, reason: 'not_issuable' } as LeaseResult;
  });

  if (result.ok && result.lease.status === 'issued') {
    void publishLeaseNotification(result.lease.deviceId).catch(() => {});
  }
  return result;
}

export async function acknowledgeLease(input: {
  userId: string;
  deviceId: string;
  leaseId: string;
  signature: string;
}): Promise<LeaseResult> {
  const [lease] = await db
    .select()
    .from(coworkDeviceLeases)
    .where(and(
      eq(coworkDeviceLeases.id, input.leaseId),
      eq(coworkDeviceLeases.deviceId, input.deviceId),
      eq(coworkDeviceLeases.userId, input.userId),
    ))
    .limit(1);
  if (!lease) return { ok: false, reason: 'not_found' };

  const device = await findActiveCoworkDevice(input.userId, input.deviceId);
  if (!device || !verifyCoworkSignature(device.publicKey, `cowork-lease-ack-v1:${lease.id}.${lease.nonce}`, input.signature)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const now = new Date();
  const [acknowledged] = await db
    .update(coworkDeviceLeases)
    .set({ status: 'acknowledged', acknowledgedAt: now })
    .where(and(
      eq(coworkDeviceLeases.id, input.leaseId),
      eq(coworkDeviceLeases.deviceId, input.deviceId),
      eq(coworkDeviceLeases.userId, input.userId),
      eq(coworkDeviceLeases.status, 'issued'),
      gt(coworkDeviceLeases.expiresAt, now),
      sql`EXISTS (SELECT 1 FROM cowork_devices d WHERE d.id = ${coworkDeviceLeases.deviceId} AND d.user_id = ${input.userId} AND d.status = 'active')`,
      sql`EXISTS (SELECT 1 FROM cowork_devices d JOIN cowork_device_provisioning kp ON kp.public_key = d.public_key WHERE d.id = ${coworkDeviceLeases.deviceId} AND kp.status = 'active' AND kp.kiosk_surface = ${COWORK_KIOSK_SURFACE} AND kp.capability_ids @> ${JSON.stringify(['screen_capture', 'input_action'])}::jsonb)`,
    ))
    .returning();
  return acknowledged ? { ok: true, lease: toLease(acknowledged) } : { ok: false, reason: 'not_issuable' };
}

/** Device posts only a signed, bounded terminal outcome; never pixels or typed content. */
export async function completeLease(input: {
  userId: string;
  deviceId: string;
  leaseId: string;
  outcome: 'FAIT' | 'PAS-FAIT';
  signature: string;
}): Promise<LeaseResult> {
  const [lease] = await db.select().from(coworkDeviceLeases).where(and(
    eq(coworkDeviceLeases.id, input.leaseId),
    eq(coworkDeviceLeases.deviceId, input.deviceId),
    eq(coworkDeviceLeases.userId, input.userId),
  )).limit(1);
  if (!lease) return { ok: false, reason: 'not_found' };
  const device = await findActiveCoworkDevice(input.userId, input.deviceId);
  if (!device || !verifyCoworkSignature(
    device.publicKey,
    `cowork-lease-result-v1:${lease.id}.${lease.nonce}.${input.outcome}`,
    input.signature,
  )) return { ok: false, reason: 'invalid_signature' };

  const now = new Date();
  const status = input.outcome === 'FAIT' ? 'consumed' : 'revoked';
  const [completed] = await db.update(coworkDeviceLeases).set({ status, consumedAt: now }).where(and(
    eq(coworkDeviceLeases.id, input.leaseId),
    eq(coworkDeviceLeases.deviceId, input.deviceId),
    eq(coworkDeviceLeases.userId, input.userId),
    eq(coworkDeviceLeases.status, 'acknowledged'),
    gt(coworkDeviceLeases.expiresAt, now),
  )).returning();
  return completed ? { ok: true, lease: toLease(completed) } : { ok: false, reason: 'not_issuable' };
}

/** Atomic lazy expiry is the fallback for an offline or malformed device result. */
export async function readLeaseOutcome(leaseId: string): Promise<'FAIT' | 'PAS-FAIT' | null> {
  const now = new Date();
  await db.update(coworkDeviceLeases).set({ status: 'expired' }).where(and(
    eq(coworkDeviceLeases.id, leaseId),
    inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES),
    lte(coworkDeviceLeases.expiresAt, now),
  ));
  const [lease] = await db.select({ status: coworkDeviceLeases.status }).from(coworkDeviceLeases)
    .where(eq(coworkDeviceLeases.id, leaseId)).limit(1);
  if (!lease) return 'PAS-FAIT';
  return lease.status === 'consumed' ? 'FAIT' : ['expired', 'revoked'].includes(lease.status) ? 'PAS-FAIT' : null;
}

/** Lot 4 will call this primitive before any external screen-side effect. */
export async function revokeLease(leaseId: string, reason: string, userId?: string): Promise<LeaseResult> {
  void reason; // Audit persistence is intentionally deferred with Lot 4's result protocol.
  const where = userId
    ? and(eq(coworkDeviceLeases.id, leaseId), eq(coworkDeviceLeases.userId, userId), inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES))
    : and(eq(coworkDeviceLeases.id, leaseId), inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES));
  const [revoked] = await db.update(coworkDeviceLeases).set({ status: 'revoked' }).where(where).returning();
  return revoked ? { ok: true, lease: toLease(revoked) } : { ok: false, reason: 'not_revocable' };
}

export async function listIssuedLeases(userId: string, deviceId: string, limit = 20) {
  const device = await findActiveCoworkDevice(userId, deviceId);
  if (!device) return null;
  const now = new Date();
  return db
    .select()
    .from(coworkDeviceLeases)
    .where(and(
      eq(coworkDeviceLeases.userId, userId),
      eq(coworkDeviceLeases.deviceId, deviceId),
      eq(coworkDeviceLeases.status, 'issued'),
      gt(coworkDeviceLeases.expiresAt, now),
    ))
    .limit(Math.min(Math.max(limit, 1), 50));
}
