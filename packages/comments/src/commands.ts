/**
 * Canonical command contracts (SPEC §4.4, §5): capabilities with default
 * denial, idempotency with CAS, and G4 human-decision binding without
 * circular output hashes.
 */

import type { IdempotencyKey } from '@sentropic/contracts';
import { idempotencyKey } from '@sentropic/contracts';
import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './sha256.js';
import type { ResourceRef } from './anchors.js';
import type { ResolverOutcome } from './anchors.js';

/** Host-granted capabilities (SPEC §5); creator/admin permission never confers review rights. */
export const COMMAND_CAPABILITIES = [
  'read',
  'comment',
  'revise',
  'assign',
  'resolve-discussion',
  'review',
  'contest',
  'resolve-contest',
  'shared-archive',
  'shared-restore',
  'personal-archive',
  'tombstone',
  'purge',
  'submit-to-ai',
] as const;

export type CommandCapability = (typeof COMMAND_CAPABILITIES)[number];

export const isCommandCapability = (value: unknown): value is CommandCapability =>
  typeof value === 'string' && (COMMAND_CAPABILITIES as readonly string[]).includes(value);

/** Host-injected capability check; unconfigured capabilities deny by default. */
export type CapabilityCheckPort = {
  check(principal: string, capability: CommandCapability, targets: readonly ResourceRef[]): Promise<boolean>;
};

/** Denying capability check used when a host injects no policy. */
export const defaultDenyCapabilityCheck: CapabilityCheckPort = {
  check: async () => false,
};

/** Host resource/version resolver with explicit outcomes only. */
export type ResourceResolverPort = {
  resolve(principal: string, resource: ResourceRef): Promise<ResolverOutcome>;
};

/** Command error with a closed reason code (SPEC §5: 401/403/404/409/400 analogues). */
export class CanonicalCommandError extends Error {
  constructor(
    public readonly code:
      | 'cas-conflict'
      | 'idempotency-conflict'
      | 'denied'
      | 'invalid-command'
      | 'not-found',
    message: string,
  ) {
    super(message);
    this.name = 'CanonicalCommandError';
  }
}

/** Expected state for CAS: an exact head revision, or creation with an aggregate version. */
export type ExpectedState =
  | { readonly kind: 'revision'; readonly revisionHash: string }
  | { readonly kind: 'creation'; readonly aggregateVersion: number };

/** Authenticated principal issuing a command. */
export type CommandActor = { readonly principal: string };

/** Canonical command envelope: every state-changing command carries scope, idempotency key and expected state. */
export type CanonicalCommandEnvelope<TPayload> = {
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
