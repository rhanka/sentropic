/**
 * L-5a — generic provider definitions (spec-v8 §9).
 *
 * A provider definition binds a provider ID to its capabilities and its
 * parameter schema. Provider-internal keys are (providerId, capabilityName);
 * the external map is exact publicName → that pair. Duplicate public names
 * are rejected at definition time; cross-provider collisions are rejected by
 * `assertNoPublicNameCollisions` before activation. No sanitizing,
 * suffixing, auto-prefixing or silent first/last keep.
 */
import type { ParameterSchema } from './parameters.js';

export type CapabilityKind = 'tool' | 'resource' | 'prompt';

export interface CapabilityDefinition {
  kind: CapabilityKind;
  /** Internal capability name, unique within the provider. */
  name: string;
  /** Exact external name; must be unique across all activated providers. */
  publicName: string;
  description?: string;
}

export interface ProviderDefinition {
  providerId: string;
  version: string;
  parameters: ParameterSchema;
  capabilities: CapabilityDefinition[];
}

export interface ResolvedCapability {
  providerId: string;
  capabilityName: string;
}

/** Define a provider; rejects empty IDs and duplicate public/capability names. */
export function defineProvider(def: ProviderDefinition): ProviderDefinition {
  if (typeof def.providerId !== 'string' || def.providerId.length === 0) {
    throw new Error('invalid provider definition: empty providerId');
  }
  const publicNames = new Set<string>();
  const names = new Set<string>();
  for (const cap of def.capabilities) {
    if (names.has(cap.name)) {
      throw new Error(`invalid provider definition: duplicate capability name ${cap.name}`);
    }
    names.add(cap.name);
    if (publicNames.has(cap.publicName)) {
      throw new Error(`invalid provider definition: duplicate publicName ${cap.publicName}`);
    }
    publicNames.add(cap.publicName);
  }
  return {
    providerId: def.providerId,
    version: def.version,
    parameters: def.parameters,
    capabilities: [...def.capabilities],
  };
}

/** Exact publicName → (providerId, capabilityName) map for one provider. */
export function publicNameMap(def: ProviderDefinition): Map<string, ResolvedCapability> {
  const map = new Map<string, ResolvedCapability>();
  for (const cap of def.capabilities) {
    map.set(cap.publicName, { providerId: def.providerId, capabilityName: cap.name });
  }
  return map;
}

/** Reject tool-name collisions across providers before activation. */
export function assertNoPublicNameCollisions(defs: ProviderDefinition[]): void {
  const seen = new Map<string, string>();
  for (const def of defs) {
    for (const cap of def.capabilities) {
      const owner = seen.get(cap.publicName);
      if (owner !== undefined && owner !== def.providerId) {
        throw new Error(
          `publicName collision: ${cap.publicName} claimed by ${owner} and ${def.providerId}`,
        );
      }
      seen.set(cap.publicName, def.providerId);
    }
  }
}
