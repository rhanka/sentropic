import { createHash } from 'node:crypto';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';

import { db, pool } from '../../db/client';
import { coworkDeviceLeases, coworkDevices } from '../../db/schema';
import { findActiveCoworkDevice, verifyCoworkSignature } from './device-identity';
import { parseCoworkInputAction } from './input-action-schema';
import { isCoworkScreenCaptureAction } from './screen-capture-action-schema';
import { COWORK_KIOSK_SURFACE } from './provisioning';
import { signLeaseEnvelope, type ServerSignedLeaseEnvelope } from './lease-envelope';

// The device receives a five-second quiescence window before the connector's
// ratified 30-second bounded result deadline.
const LEASE_TTL_MS = 25_000;
const PRESENCE_FRESHNESS_MS = 45_000;
const IN_FLIGHT_STATUSES = ['issued', 'acknowledged', 'executing'] as const;
const REVOCABLE_LEASE_STATUSES = ['issued', 'acknowledged'] as const;

export type LeaseScope = {
  capability: 'screen_capture' | 'input_action';
  serverEnvelope: ServerSignedLeaseEnvelope;
  /** Delivered to the device for foreground consent; never emitted to audit. */
  action?: Record<string, unknown>;
  /** Durable idempotency binding; never sourced from a mutable mount field. */
  invocation?: CoworkInvocationBinding;
  /** Server-side stop/timeout request; executing remains non-terminal until device quiescence. */
  cancellationRequestedAt?: string;
  result?: Record<string, unknown>;
  resultDigest?: string;
} | null;
export type LeaseIssueScope = {
  capability: 'screen_capture' | 'input_action';
  action?: Record<string, unknown>;
} | null;
type LeaseStatus = 'issued' | 'acknowledged' | 'executing' | 'consumed' | 'expired' | 'revoked';

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

export const coworkResultDigest = (result: Record<string, unknown> | undefined): string => coworkActionHash(result);

function validCaptureResult(result: unknown, action: unknown): result is Record<string, unknown> {
  if (!isCoworkScreenCaptureAction(action)) return false;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const value = result as Record<string, unknown>;
  if (value.ok !== true || value.screen !== 0
    || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || (value.width as number) < 1 || (value.height as number) < 1
    || typeof value.image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(value.image)) return false;
  const encoded = value.image.slice(value.image.indexOf(',') + 1);
  return Buffer.from(encoded, 'base64').byteLength > 0 && Buffer.from(encoded, 'base64').byteLength <= 4 * 1024 * 1024;
}

function validInputResult(result: unknown, expectedAction: unknown): result is Record<string, unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const value = result as Record<string, unknown>;
  const action = parseCoworkInputAction(expectedAction);
  return Boolean(action
    && value.ok === true
    && value.action === action.action
    && value.actionDigest === coworkActionHash(action)
    && Object.keys(value).every((key) => key === 'ok' || key === 'action' || key === 'actionDigest'));
}

function validCompletionResult(scope: LeaseScope, outcome: 'FAIT' | 'PAS-FAIT', result: unknown): result is Record<string, unknown> | undefined {
  if (outcome === 'PAS-FAIT') return result === undefined;
  return scope?.capability === 'screen_capture'
    ? validCaptureResult(result, scope.action ?? {})
    : validInputResult(result, scope?.action);
}

function hasBinding(scope: LeaseScope, expected: CoworkInvocationBinding): boolean {
  if (!scope || typeof scope !== 'object') return false;
  const binding = (scope as LeaseScope & { invocation?: unknown }).invocation;
  return canonicalJson(binding) === canonicalJson(expected);
}

function exposureBinding(scope: LeaseScope, deviceId: string, userId: string): CoworkInvocationBinding | null {
  const binding = scope?.invocation;
  if (!binding
    || binding.targetDeviceId !== deviceId
    || binding.principalId !== userId
    || (binding.capability !== 'screen_capture' && binding.capability !== 'input_action')
    || typeof binding.workspaceId !== 'string'
    || typeof binding.sessionId !== 'string'
    || typeof binding.actionHash !== 'string') return null;
  return binding;
}

export type LeaseResult =
  | { ok: true; lease: { leaseId: string; deviceId: string; nonce: string; scope: LeaseScope; expiresAt: Date; status: LeaseStatus } }
  | { ok: false; reason: 'ineligible' | 'not_found' | 'invalid_signature' | 'not_issuable' | 'not_revocable' | 'cancelled' | 'execution_in_progress' };

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
  const canonicalInputAction = requestedCapability === 'input_action' ? parseCoworkInputAction(input.scope?.action) : null;
  if (requestedCapability === 'input_action' && !canonicalInputAction) return { ok: false, reason: 'not_issuable' };
  if (requestedCapability === 'screen_capture' && !isCoworkScreenCaptureAction(input.scope?.action ?? {})) {
    return { ok: false, reason: 'not_issuable' };
  }
  const canonicalAction = canonicalInputAction ?? input.scope?.action;
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
    actionHash: coworkActionHash(canonicalAction),
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
      // The device row is locked for this whole issuance transaction, just like
      // claimLeaseExecution. A mismatched invocation may cancel an unstarted
      // owner, but it must never terminalize an executing owner that can still
      // be actuating on the target.
      await tx.update(coworkDeviceLeases).set({ status: 'revoked' }).where(and(
        eq(coworkDeviceLeases.id, existing.id),
        inArray(coworkDeviceLeases.status, REVOCABLE_LEASE_STATUSES),
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
          ...(canonicalAction ? { action: canonicalAction } : {}),
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
      inArray(coworkDeviceLeases.status, REVOCABLE_LEASE_STATUSES),
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
  const binding = exposureBinding(lease.scope as LeaseScope, input.deviceId, input.userId);
  if (!binding) return { ok: false, reason: 'not_issuable' };
  return db.transaction(async (tx) => {
    // This is the same lock used by issue, start, deletion, and explicit
    // exposure revocation. The grant cannot disappear after its check.
    const locked = await tx.execute(sql`
      SELECT d.id
      FROM cowork_devices d
      JOIN cowork_device_provisioning kp ON kp.public_key = d.public_key
      WHERE d.id = ${input.deviceId}
        AND d.user_id = ${input.userId}
        AND d.status = 'active'
        AND kp.status = 'active'
        AND kp.kiosk_surface = ${COWORK_KIOSK_SURFACE}
        AND kp.capability_ids @> ${JSON.stringify(['screen_capture', 'input_action'])}::jsonb
      FOR UPDATE OF d
    `);
    if (locked.rows.length === 0) return { ok: false, reason: 'not_issuable' } as LeaseResult;
    const [acknowledged] = await tx.update(coworkDeviceLeases)
      .set({ status: 'acknowledged', acknowledgedAt: now })
      .where(and(
        eq(coworkDeviceLeases.id, input.leaseId),
        eq(coworkDeviceLeases.deviceId, input.deviceId),
        eq(coworkDeviceLeases.userId, input.userId),
        eq(coworkDeviceLeases.status, 'issued'),
        gt(coworkDeviceLeases.expiresAt, now),
        sql`EXISTS (SELECT 1 FROM cowork_device_exposure_grants g WHERE g.device_id = ${input.deviceId} AND g.workspace_id = ${binding.workspaceId} AND g.capability = ${binding.capability})`,
      ))
      .returning();
    return acknowledged ? { ok: true, lease: toLease(acknowledged) } : { ok: false, reason: 'not_issuable' } as LeaseResult;
  });
}

/**
 * Final device start claim.  It shares the device-row lock with deletion, while
 * its acknowledged->executing update races revocation exactly once.
 */
export async function claimLeaseExecution(input: {
  userId: string;
  deviceId: string;
  leaseId: string;
  signature: string;
}): Promise<LeaseResult> {
  const [lease] = await db.select().from(coworkDeviceLeases).where(and(
    eq(coworkDeviceLeases.id, input.leaseId), eq(coworkDeviceLeases.deviceId, input.deviceId), eq(coworkDeviceLeases.userId, input.userId),
  )).limit(1);
  if (!lease) return { ok: false, reason: 'not_found' };
  const device = await findActiveCoworkDevice(input.userId, input.deviceId);
  if (!device || !verifyCoworkSignature(device.publicKey, `cowork-lease-start-v1:${lease.id}.${lease.nonce}`, input.signature)) {
    return { ok: false, reason: 'invalid_signature' };
  }
  const now = new Date();
  const binding = exposureBinding(lease.scope as LeaseScope, input.deviceId, input.userId);
  if (!binding) return { ok: false, reason: 'not_issuable' };
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT id FROM cowork_devices
      WHERE id = ${input.deviceId} AND user_id = ${input.userId} AND status = 'active'
      FOR UPDATE
    `);
    if (locked.rows.length === 0) return { ok: false, reason: 'cancelled' } as LeaseResult;
    const [claimed] = await tx.update(coworkDeviceLeases).set({ status: 'executing' }).where(and(
      eq(coworkDeviceLeases.id, input.leaseId), eq(coworkDeviceLeases.deviceId, input.deviceId),
      eq(coworkDeviceLeases.userId, input.userId), eq(coworkDeviceLeases.status, 'acknowledged'), gt(coworkDeviceLeases.expiresAt, now),
      sql`EXISTS (SELECT 1 FROM cowork_device_exposure_grants g WHERE g.device_id = ${input.deviceId} AND g.workspace_id = ${binding.workspaceId} AND g.capability = ${binding.capability})`,
    )).returning();
    if (claimed) return { ok: true, lease: toLease(claimed) } as LeaseResult;
    const [current] = await tx.select({ status: coworkDeviceLeases.status }).from(coworkDeviceLeases)
      .where(eq(coworkDeviceLeases.id, input.leaseId)).limit(1);
    return { ok: false, reason: current?.status === 'revoked' ? 'cancelled' : 'not_issuable' } as LeaseResult;
  });
}

/** A revoked lease is acknowledged by the device before it can enter its provider. */
export async function acknowledgeLeaseCancellation(input: {
  userId: string;
  deviceId: string;
  leaseId: string;
  signature: string;
}): Promise<LeaseResult> {
  const [lease] = await db.select().from(coworkDeviceLeases).where(and(
    eq(coworkDeviceLeases.id, input.leaseId), eq(coworkDeviceLeases.deviceId, input.deviceId), eq(coworkDeviceLeases.userId, input.userId),
  )).limit(1);
  if (!lease) return { ok: false, reason: 'not_found' };
  const device = await findActiveCoworkDevice(input.userId, input.deviceId);
  if (!device || !verifyCoworkSignature(device.publicKey, `cowork-lease-cancel-v1:${lease.id}.${lease.nonce}`, input.signature)) {
    return { ok: false, reason: 'invalid_signature' };
  }
  const scope = { ...(lease.scope as LeaseScope), cancellationAcknowledgedAt: new Date().toISOString() };
  const [acknowledged] = await db.update(coworkDeviceLeases).set({ scope }).where(and(
    eq(coworkDeviceLeases.id, input.leaseId), eq(coworkDeviceLeases.status, 'revoked'),
  )).returning();
  return acknowledged ? { ok: true, lease: toLease(acknowledged) } : { ok: false, reason: 'not_issuable' };
}

/** Device posts only a signed, bounded terminal outcome; never pixels or typed content. */
export async function completeLease(input: {
  userId: string;
  deviceId: string;
  leaseId: string;
  outcome: 'FAIT' | 'PAS-FAIT';
  result?: Record<string, unknown>;
  signature: string;
}): Promise<LeaseResult> {
  const [lease] = await db.select().from(coworkDeviceLeases).where(and(
    eq(coworkDeviceLeases.id, input.leaseId),
    eq(coworkDeviceLeases.deviceId, input.deviceId),
    eq(coworkDeviceLeases.userId, input.userId),
  )).limit(1);
  if (!lease) return { ok: false, reason: 'not_found' };
  const device = await findActiveCoworkDevice(input.userId, input.deviceId);
  const scope = lease.scope as LeaseScope;
  if (!validCompletionResult(scope, input.outcome, input.result)) return { ok: false, reason: 'not_issuable' };
  const resultDigest = coworkResultDigest(input.result);
  if (!device || !verifyCoworkSignature(
    device.publicKey,
    `cowork-lease-result-v1:${lease.id}.${lease.nonce}.${input.outcome}.${resultDigest}`,
    input.signature,
  )) return { ok: false, reason: 'invalid_signature' };

  const now = new Date();
  const status = input.outcome === 'FAIT' ? 'consumed' : 'revoked';
  const completedScope = { ...scope, ...(input.result ? { result: input.result, resultDigest } : {}) };
  const [completed] = await db.update(coworkDeviceLeases).set({ status, consumedAt: now, scope: completedScope }).where(and(
    eq(coworkDeviceLeases.id, input.leaseId),
    eq(coworkDeviceLeases.deviceId, input.deviceId),
    eq(coworkDeviceLeases.userId, input.userId),
    eq(coworkDeviceLeases.status, 'executing'),
    // A Stop/timeout cancellation is a durable fence, not merely advisory to
    // the device.  Once it is recorded, a late FAIT cannot win the race after
    // the local native provider has been told to quiesce.
    ...(input.outcome === 'FAIT' ? [
      gt(coworkDeviceLeases.expiresAt, now),
      sql`NOT (${coworkDeviceLeases.scope} ? 'cancellationRequestedAt')`,
    ] : []),
  )).returning();
  return completed ? { ok: true, lease: toLease(completed) } : { ok: false, reason: 'not_issuable' };
}

/** Atomic lazy expiry is the fallback for an offline or malformed device result. */
export type LeaseOutcome = { outcome: 'FAIT'; result: Record<string, unknown> } | { outcome: 'PAS-FAIT' };

export async function readLeaseOutcome(leaseId: string): Promise<LeaseOutcome | null> {
  const now = new Date();
  await db.update(coworkDeviceLeases).set({ status: 'expired' }).where(and(
    eq(coworkDeviceLeases.id, leaseId),
    inArray(coworkDeviceLeases.status, REVOCABLE_LEASE_STATUSES),
    lte(coworkDeviceLeases.expiresAt, now),
  ));
  const [lease] = await db.select({ status: coworkDeviceLeases.status, scope: coworkDeviceLeases.scope }).from(coworkDeviceLeases)
    .where(eq(coworkDeviceLeases.id, leaseId)).limit(1);
  if (!lease) return { outcome: 'PAS-FAIT' };
  if (lease.status === 'consumed') {
    const result = (lease.scope as LeaseScope | null)?.result;
    return result ? { outcome: 'FAIT', result } : { outcome: 'PAS-FAIT' };
  }
  return ['expired', 'revoked'].includes(lease.status) ? { outcome: 'PAS-FAIT' } : null;
}

/** Lot 4 will call this primitive before any external screen-side effect. */
export async function revokeLease(leaseId: string, reason: string, userId?: string): Promise<LeaseResult> {
  void reason; // Audit persistence is intentionally deferred with Lot 4's result protocol.
  const where = userId
    ? and(eq(coworkDeviceLeases.id, leaseId), eq(coworkDeviceLeases.userId, userId), inArray(coworkDeviceLeases.status, REVOCABLE_LEASE_STATUSES))
    : and(eq(coworkDeviceLeases.id, leaseId), inArray(coworkDeviceLeases.status, REVOCABLE_LEASE_STATUSES));
  const [revoked] = await db.update(coworkDeviceLeases).set({ status: 'revoked' }).where(where).returning();
  if (revoked) return { ok: true, lease: toLease(revoked) };
  const [current] = await db.select({ status: coworkDeviceLeases.status, scope: coworkDeviceLeases.scope }).from(coworkDeviceLeases).where(and(
    eq(coworkDeviceLeases.id, leaseId), ...(userId ? [eq(coworkDeviceLeases.userId, userId)] : []),
  )).limit(1);
  if (current?.status === 'executing') {
    const scope = { ...(current.scope as LeaseScope), cancellationRequestedAt: new Date().toISOString() };
    await db.update(coworkDeviceLeases).set({ scope }).where(and(
      eq(coworkDeviceLeases.id, leaseId), eq(coworkDeviceLeases.status, 'executing'),
      ...(userId ? [eq(coworkDeviceLeases.userId, userId)] : []),
    ));
  }
  return { ok: false, reason: current?.status === 'executing' ? 'execution_in_progress' : 'not_revocable' };
}

/** Device-only cancellation signal for an already-started lease; never terminal by itself. */
export async function isLeaseCancellationRequested(input: { userId: string; deviceId: string; leaseId: string }): Promise<boolean | null> {
  const [lease] = await db.select({ status: coworkDeviceLeases.status, scope: coworkDeviceLeases.scope }).from(coworkDeviceLeases).where(and(
    eq(coworkDeviceLeases.id, input.leaseId),
    eq(coworkDeviceLeases.deviceId, input.deviceId),
    eq(coworkDeviceLeases.userId, input.userId),
  )).limit(1);
  if (!lease) return null;
  return lease.status === 'executing' && Boolean((lease.scope as LeaseScope | null)?.cancellationRequestedAt);
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
