// Row codecs for the identity slice. Both profiles emit the same snake_case
// columns (PostgreSQL via the InjectedPgDriver session, SQLite through
// node:sqlite's object rows), so one decode layer serves both. SQL NULL maps
// to the frozen records' `undefined` optional fields; decode is defensive on
// union fields: unexpected values surface as a typed error from the port
// rather than corrupting a record.

import type { DeviceCodeRecord, IdentityProof, InvitationRecord, LoginSession, UserAccount } from '../../identity-contracts/index.js';

export class IdentityRowError extends Error {
  constructor(readonly table: string, readonly reason: string) {
    super(`Invalid identity row in ${table}: ${reason}`);
  }
}

const text = (table: string, row: Record<string, unknown>, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') throw new IdentityRowError(table, `column ${column} is not text`);
  return value;
};

const optionalText = (row: Record<string, unknown>, column: string): string | undefined => {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') throw new IdentityRowError('identity slice', `column ${column} is not text`);
  return value;
};

const integer = (table: string, row: Record<string, unknown>, column: string): number => {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new IdentityRowError(table, `column ${column} is not an integer`);
  return value;
};

export const decodeUserAccount = (row: Record<string, unknown>): UserAccount => ({
  userId: text('identity_user_accounts', row, 'user_id'),
  email: text('identity_user_accounts', row, 'email'),
  accountStatus: text('identity_user_accounts', row, 'account_status') as UserAccount['accountStatus'],
  globalRole: text('identity_user_accounts', row, 'global_role') as UserAccount['globalRole'],
  createdAt: text('identity_user_accounts', row, 'created_at'),
  updatedAt: text('identity_user_accounts', row, 'updated_at'),
});

export const decodeProof = (row: Record<string, unknown>): IdentityProof => ({
  proofId: text('identity_proofs', row, 'proof_id'),
  userId: text('identity_proofs', row, 'user_id'),
  kind: text('identity_proofs', row, 'kind') as IdentityProof['kind'],
  provider: optionalText(row, 'provider'),
  expiresAt: optionalText(row, 'expires_at'),
  consumedAt: optionalText(row, 'consumed_at'),
  revokedAt: optionalText(row, 'revoked_at'),
  createdAt: text('identity_proofs', row, 'created_at'),
});

export const decodeInvitation = (row: Record<string, unknown>): InvitationRecord => ({
  invitationId: text('identity_invitations', row, 'invitation_id'),
  email: text('identity_invitations', row, 'email'),
  tenantId: optionalText(row, 'tenant_id'),
  workspaceId: optionalText(row, 'workspace_id'),
  token: text('identity_invitations', row, 'token'),
  status: text('identity_invitations', row, 'status') as InvitationRecord['status'],
  expiresAt: text('identity_invitations', row, 'expires_at'),
  consumedAt: optionalText(row, 'consumed_at'),
});

export const decodeDeviceCode = (row: Record<string, unknown>): DeviceCodeRecord => ({
  deviceCode: text('identity_device_codes', row, 'device_code'),
  userCode: text('identity_device_codes', row, 'user_code'),
  deviceName: optionalText(row, 'device_name') ?? null,
  status: text('identity_device_codes', row, 'status') as DeviceCodeRecord['status'],
  approvedUserId: optionalText(row, 'approved_user_id'),
  approvedAt: optionalText(row, 'approved_at'),
  issuedAt: text('identity_device_codes', row, 'issued_at'),
  expiresAt: text('identity_device_codes', row, 'expires_at'),
});

export const decodeSession = (row: Record<string, unknown>): LoginSession => ({
  sessionId: text('identity_login_sessions', row, 'session_id'),
  userId: text('identity_login_sessions', row, 'user_id'),
  status: text('identity_login_sessions', row, 'status') as LoginSession['status'],
  mfaState: text('identity_login_sessions', row, 'mfa_state') as LoginSession['mfaState'],
  createdAt: text('identity_login_sessions', row, 'created_at'),
  expiresAt: text('identity_login_sessions', row, 'expires_at'),
  revokedAt: optionalText(row, 'revoked_at'),
  refreshCount: integer('identity_login_sessions', row, 'refresh_count'),
});
