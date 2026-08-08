/**
 * The narrow Option-B target attestation.  `kioskSurface` is deliberately not
 * inferred from a device name or model input: enrollment must state it.
 *
 * OQ-5 semantic denials are satisfied BY CONSTRUCTION for this MVP: the
 * provisioned isolated VM exposes only this benign kiosk app.  This marker is
 * a fail-closed admission check, not a general-purpose semantic input filter.
 * The general computer-use surface needs its separately ratified trusted
 * policy/human-in-the-loop envelope.
 */
export type CoworkDeviceCapability = 'screen_capture' | 'input_action';

export type CoworkDeviceCapabilities = {
  capabilityIds: CoworkDeviceCapability[];
  /** Untrusted enrollment telemetry; never an authorization signal. */
  isolatedVmTarget?: boolean;
  /** Untrusted enrollment telemetry; never an authorization signal. */
  kioskSurface?: string;
};

export const COWORK_CAPABILITY_IDS = ['screen_capture', 'input_action'] as const;

export function isCoworkDeviceCapabilities(value: unknown): value is CoworkDeviceCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.capabilityIds)
    && candidate.capabilityIds.every((capability) => COWORK_CAPABILITY_IDS.includes(capability as CoworkDeviceCapability))
    && (candidate.isolatedVmTarget === undefined || typeof candidate.isolatedVmTarget === 'boolean')
    && (candidate.kioskSurface === undefined || (typeof candidate.kioskSurface === 'string' && candidate.kioskSurface.trim().length > 0));
}

/** Never promote a legacy array into a safe target: missing attestation denies. */
export function normalizeCoworkDeviceCapabilities(value: unknown): CoworkDeviceCapabilities | null {
  if (!isCoworkDeviceCapabilities(value)) return null;
  return {
    capabilityIds: [...value.capabilityIds],
    ...(typeof value.isolatedVmTarget === 'boolean' ? { isolatedVmTarget: value.isolatedVmTarget } : {}),
    ...(value.kioskSurface ? { kioskSurface: value.kioskSurface.trim() } : {}),
  };
}

export function isNarrowCoworkKioskTarget(value: unknown): boolean {
  // Client-held capability JSON contains only CLAIMED attributes. The only
  // attestation is the server-side public-key provisioning record.
  void value;
  return false;
}
