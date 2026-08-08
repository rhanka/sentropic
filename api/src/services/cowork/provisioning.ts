import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { coworkDeviceExposureGrants, coworkDeviceProvisioning, coworkDevices } from '../../db/schema';

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
