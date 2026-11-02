import { createHash } from 'node:crypto';
import * as core from './cm-import-mapping';
import * as continuations from './cm-import-continuations';
import * as tenancy from './cm-import-tenancy';
import * as values from './cm-import-values';
import * as remote from './cm-import-remote';
import * as remoteSnapshot from './cm-import-remote-snapshot';
import * as invitations from './cm-import-invitations';
import * as connectors from './cm-import-connectors';

/** Exhaustive columns of the source tables removed by this single cutover. */
export const a4SourceFieldManifest: Readonly<Record<string, readonly string[]>> = {
  users: ['id', 'email', 'display_name', 'role', 'account_status', 'approval_due_at', 'approved_at',
    'approved_by_user_id', 'disabled_at', 'disabled_reason', 'email_verified', 'created_at', 'updated_at'],
  webauthn_credentials: ['id', 'credential_id', 'public_key_cose', 'counter', 'user_id', 'device_name',
    'transports_json', 'uv', 'created_at', 'last_used_at'],
  webauthn_challenges: ['id', 'challenge', 'user_id', 'type', 'expires_at', 'used', 'created_at'],
  email_verification_codes: ['id', 'code_hash', 'email', 'verification_token', 'expires_at', 'used', 'created_at'],
  magic_links: ['id', 'token_hash', 'email', 'user_id', 'expires_at', 'used', 'created_at'],
  auth_invite_tokens: ['id', 'token_hash', 'email', 'client_id', 'expires_at', 'consumed_at', 'consumed_by_user_id', 'created_at'],
  user_sessions: ['id', 'user_id', 'session_token_hash', 'refresh_token_hash', 'device_name', 'ip_address',
    'user_agent', 'mfa_verified', 'expires_at', 'created_at', 'last_activity_at'],
  identities: ['id', 'user_id', 'provider', 'provider_subject', 'email_at_link', 'email_verified_by_provider',
    'provider_tenant', 'token_secret', 'linked_at', 'last_login_at'],
  tenants: ['id', 'name', 'status', 'created_at', 'updated_at'],
  tenant_memberships: ['tenant_id', 'user_id', 'status', 'role', 'approved_by_user_id', 'requested_at',
    'decided_at', 'created_at', 'updated_at'],
  workspace_memberships: ['workspace_id', 'user_id', 'role', 'created_at'],
};

// These descriptive/history fields are retained by the protected source checkpoint,
// with its explicit metadata-disposition receipt. They never become runtime authority.
export const a4CheckpointHistoricalFields = {
  tenants: ['name', 'updated_at'],
  tenant_memberships: ['requested_at', 'created_at'],
  workspace_memberships: ['created_at'],
} as const;

export function assertA4SourceInventory(inventory: Readonly<Record<string, { readonly fields: readonly string[] }>>): void {
  for (const [table, fields] of Object.entries(a4SourceFieldManifest)) {
    const actual = inventory[table]?.fields;
    if (!actual || actual.length !== fields.length || fields.some(field => !actual.includes(field))) values.invalidA4Import();
  }
}

/** Hash the shipped mapping implementation and pinned verifier policy; never key bytes or row material. */
export const a4MappingAssetSha256 = (verifier: { readonly rpId: string; readonly origins: readonly string[] }): string => {
  const functions = Object.entries({ ...core, ...continuations, ...tenancy, ...values,
    ...remote, ...remoteSnapshot, ...invitations, ...connectors })
    .filter(([, implementation]) => typeof implementation === 'function')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, implementation]) => [name, Function.prototype.toString.call(implementation)]);
  return createHash('sha256').update(JSON.stringify({ contractVersion: '1.1.0', sourceTimeZone: 'UTC',
    fields: a4SourceFieldManifest, historicalFields: a4CheckpointHistoricalFields,
    verifier: { rpId: verifier.rpId, origins: [...verifier.origins].sort(), registrationUv: 'preferred', authenticationUv: 'required' },
    functions })).digest('hex');
};
