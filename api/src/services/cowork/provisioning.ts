import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { coworkDeviceExposureGrants, coworkDeviceLeases, coworkDeviceProvisioning, coworkDevices, workspaceMemberships } from '../../db/schema';

export const COWORK_KIOSK_SURFACE = 'notepad';
export const COWORK_REMOTE_CAPABILITIES = ['screen_capture', 'input_action'] as const;
export type CoworkRemoteCapability = typeof COWORK_REMOTE_CAPABILITIES[number];

const hasAllRemoteCapabilities = (value: unknown): boolean => Array.isArray(value)
  && COWORK_REMOTE_CAPABILITIES.every((capability) => value.includes(capability));

/**
 * Called only by the authenticated conductor/VM-rental provisioning route.
 * Enrollment cannot create this record; it can only present a matching key.
 */
export async function registerCoworkKioskProvisioning(input: {
  publicKey: string;
  provisionedBy: string;
}): Promise<void> {
  await db.insert(coworkDeviceProvisioning).values({
    publicKey: input.publicKey,
    kioskSurface: COWORK_KIOSK_SURFACE,
    capabilityIds: [...COWORK_REMOTE_CAPABILITIES],
    provisionedBy: input.provisionedBy,
    status: 'active',
  }).onConflictDoUpdate({
    target: coworkDeviceProvisioning.publicKey,
    set: { kioskSurface: COWORK_KIOSK_SURFACE, capabilityIds: [...COWORK_REMOTE_CAPABILITIES], status: 'active', revokedAt: null },
  });
}

export async function isProvisionedCoworkPublicKey(publicKey: string): Promise<boolean> {
  const [row] = await db.select({ capabilities: coworkDeviceProvisioning.capabilityIds }).from(coworkDeviceProvisioning)
    .where(and(
      eq(coworkDeviceProvisioning.publicKey, publicKey),
      eq(coworkDeviceProvisioning.status, 'active'),
      eq(coworkDeviceProvisioning.kioskSurface, COWORK_KIOSK_SURFACE),
    )).limit(1);
  return hasAllRemoteCapabilities(row?.capabilities);
}

export async function isAttestedCoworkKioskDevice(input: { deviceId: string; userId: string }): Promise<boolean> {
  const [row] = await db.select({ capabilities: coworkDeviceProvisioning.capabilityIds }).from(coworkDevices)
    .innerJoin(coworkDeviceProvisioning, eq(coworkDeviceProvisioning.publicKey, coworkDevices.publicKey))
    .where(and(
      eq(coworkDevices.id, input.deviceId),
      eq(coworkDevices.userId, input.userId),
      eq(coworkDevices.status, 'active'),
      eq(coworkDeviceProvisioning.status, 'active'),
      eq(coworkDeviceProvisioning.kioskSurface, COWORK_KIOSK_SURFACE),
    )).limit(1);
  return hasAllRemoteCapabilities(row?.capabilities);
}

/** Authenticated conductor/admin grant; selection is forbidden from calling this. */
export async function grantCoworkWorkspaceExposure(input: {
  deviceId: string;
  workspaceId: string;
  capability: CoworkRemoteCapability;
  grantedBy: string;
}): Promise<void> {
  await db.insert(coworkDeviceExposureGrants).values(input).onConflictDoNothing();
}

/**
 * The only production grant/revoke seam.  A conductor cannot expose another
 * user's device or a workspace where it lacks admin access; the durable grant
 * itself records its actor and timestamp as redacted audit provenance.
 */
export async function manageCoworkWorkspaceExposure(input: {
  action: 'grant' | 'revoke';
  deviceId: string;
  workspaceId: string;
  capabilities: CoworkRemoteCapability[];
  actorId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    // The device row is the authorization fence shared with issue, acknowledgement,
    // and the final start claim. Lock it before reading or deleting any exposure.
    const locked = await tx.execute(sql`
      SELECT id FROM cowork_devices
      WHERE id = ${input.deviceId} AND user_id = ${input.actorId} AND status = 'active'
      FOR UPDATE
    `);
    const [membership] = await tx.select({ role: workspaceMemberships.role }).from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, input.workspaceId), eq(workspaceMemberships.userId, input.actorId),
    )).limit(1);
    if (locked.rows.length === 0 || membership?.role !== 'admin') return false;

    if (input.action === 'revoke') {
      // Lock the exact grant rows, then revoke every still-pre-start lease whose
      // durable invocation binding was authorized by those rows before deletion.
      await tx.execute(sql`
        SELECT capability FROM cowork_device_exposure_grants
        WHERE device_id = ${input.deviceId}
          AND workspace_id = ${input.workspaceId}
          AND capability IN (${sql.join(input.capabilities.map((capability) => sql`${capability}`), sql`, `)})
        FOR UPDATE
      `);
      await tx.update(coworkDeviceLeases).set({ status: 'revoked' }).where(and(
        eq(coworkDeviceLeases.deviceId, input.deviceId),
        inArray(coworkDeviceLeases.status, ['issued', 'acknowledged']),
        sql`${coworkDeviceLeases.scope} -> 'invocation' ->> 'workspaceId' = ${input.workspaceId}`,
        sql`${coworkDeviceLeases.scope} -> 'invocation' ->> 'capability' IN (${sql.join(input.capabilities.map((capability) => sql`${capability}`), sql`, `)})`,
      ));
      await tx.delete(coworkDeviceExposureGrants).where(and(
        eq(coworkDeviceExposureGrants.deviceId, input.deviceId),
        eq(coworkDeviceExposureGrants.workspaceId, input.workspaceId),
        inArray(coworkDeviceExposureGrants.capability, input.capabilities),
      ));
      return true;
    }
    await tx.insert(coworkDeviceExposureGrants).values(input.capabilities.map((capability) => ({
      deviceId: input.deviceId, workspaceId: input.workspaceId, capability, grantedBy: input.actorId,
    }))).onConflictDoNothing();
    return true;
  });
}

export async function hasCoworkWorkspaceExposure(input: {
  userId: string;
  deviceId: string;
  workspaceId: string;
  capability?: CoworkRemoteCapability;
}): Promise<boolean> {
  const [row] = await db.select({ deviceId: coworkDeviceExposureGrants.deviceId })
    .from(coworkDeviceExposureGrants)
    .innerJoin(coworkDevices, eq(coworkDevices.id, coworkDeviceExposureGrants.deviceId))
    .where(and(
      eq(coworkDeviceExposureGrants.deviceId, input.deviceId),
      eq(coworkDeviceExposureGrants.workspaceId, input.workspaceId),
      eq(coworkDevices.userId, input.userId),
      ...(input.capability ? [eq(coworkDeviceExposureGrants.capability, input.capability)] : []),
    )).limit(1);
  return Boolean(row);
}

export async function listCoworkWorkspaceExposureCapabilities(input: {
  userId: string;
  workspaceId: string;
}): Promise<CoworkRemoteCapability[]> {
  const rows = await db.select({ capability: coworkDeviceExposureGrants.capability }).from(coworkDeviceExposureGrants)
    .innerJoin(coworkDevices, eq(coworkDevices.id, coworkDeviceExposureGrants.deviceId))
    .where(and(eq(coworkDeviceExposureGrants.workspaceId, input.workspaceId), eq(coworkDevices.userId, input.userId), eq(coworkDevices.status, 'active'));
  return [...new Set(rows.map((row) => row.capability).filter((capability): capability is CoworkRemoteCapability =>
    COWORK_REMOTE_CAPABILITIES.includes(capability as CoworkRemoteCapability)));
}
