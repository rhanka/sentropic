// Identity core contracts: stable error codes. Refusals stay typed so routers
// and tests can match on `code` without parsing messages.

export class IdentityNotFoundError extends Error {
  readonly code = 'identity_not_found' as const;

  constructor(
    readonly entity: 'user' | 'tenant' | 'invitation' | 'session' | 'membership' | 'workspace',
    readonly id?: string,
  ) {
    super(`Identity ${entity} not found${id ? `: ${id}` : ''}`);
    this.name = 'IdentityNotFoundError';
  }
}

export class IdentityConflictError extends Error {
  readonly code = 'identity_conflict' as const;

  constructor(
    readonly conflict: 'email' | 'slug' | 'duplicate' | 'last_admin',
    message?: string,
  ) {
    super(message ?? `Identity conflict: ${conflict}`);
    this.name = 'IdentityConflictError';
  }
}

export class AccountNotActiveError extends Error {
  readonly code = 'account_not_active' as const;

  constructor(readonly userId?: string) {
    super(`Account is not active${userId ? `: ${userId}` : ''}`);
    this.name = 'AccountNotActiveError';
  }
}

export class AccountTransitionError extends Error {
  readonly code = 'invalid_account_transition' as const;

  constructor(message = 'Account status transition is not allowed') {
    super(message);
    this.name = 'AccountTransitionError';
  }
}

export class TenantNotActiveError extends Error {
  readonly code = 'tenant_not_active' as const;

  constructor(readonly tenantId?: string) {
    super(`Tenant is not active${tenantId ? `: ${tenantId}` : ''}`);
    this.name = 'TenantNotActiveError';
  }
}

export class TenantOffboardBlockedError extends Error {
  readonly code = 'tenant_offboard_blocked' as const;

  constructor(
    readonly tenantId: string,
    readonly liveSessions: number,
  ) {
    super(`Tenant ${tenantId} keeps ${liveSessions} live sessions; offboard is blocked without force`);
    this.name = 'TenantOffboardBlockedError';
  }
}

export class MembershipTransitionError extends Error {
  readonly code = 'invalid_membership_transition' as const;

  constructor(message = 'Tenant membership transition is not allowed') {
    super(message);
    this.name = 'MembershipTransitionError';
  }
}

export class InvitationError extends Error {
  readonly code = 'invitation_invalid' as const;

  constructor(readonly reason: 'not_found' | 'expired' | 'consumed' | 'revoked') {
    super(`Invitation is invalid: ${reason}`);
    this.name = 'InvitationError';
  }
}

export class LoginSessionError extends Error {
  readonly code = 'login_session_invalid' as const;

  constructor(readonly reason: 'not_found' | 'expired' | 'revoked') {
    super(`Login session is invalid: ${reason}`);
    this.name = 'LoginSessionError';
  }
}

export class DeviceCodeError extends Error {
  readonly code = 'device_code_invalid' as const;

  constructor(readonly reason: 'not_found' | 'expired' | 'already_resolved') {
    super(`Device code is invalid: ${reason}`);
    this.name = 'DeviceCodeError';
  }
}

export class WorkspaceAlreadyEnrolledError extends Error {
  readonly code = 'workspace_already_enrolled' as const;

  constructor(readonly workspaceId: string) {
    super(`Workspace already enrolled for this repo: ${workspaceId}`);
    this.name = 'WorkspaceAlreadyEnrolledError';
  }
}

export class SelfActionForbiddenError extends Error {
  readonly code = 'self_action_forbidden' as const;

  constructor(readonly action: 'approve' | 'disable' | 'reactivate' | 'delete') {
    super(`Admin action on self is forbidden, use self-service: ${action}`);
    this.name = 'SelfActionForbiddenError';
  }
}

export class AdminUserProtectedError extends Error {
  readonly code = 'admin_user_protected' as const;

  constructor(readonly action: 'disable' | 'delete') {
    super(`Cannot ${action} admin users`);
    this.name = 'AdminUserProtectedError';
  }
}

export class ProofVerificationError extends Error {
  readonly code = 'proof_verification_failed' as const;

  constructor(readonly reason: 'not_found' | 'expired' | 'consumed' | 'revoked' | 'mismatch') {
    super(`Identity proof verification failed: ${reason}`);
    this.name = 'ProofVerificationError';
  }
}
