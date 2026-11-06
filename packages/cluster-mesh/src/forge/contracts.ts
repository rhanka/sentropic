/** G0 v3 §2.7: trusted server ports, never MCP tools or worker bindings. */
export interface GitInstallationLeasePort {
  acquire(input: { storageScopeId: string; repoId: string; installationRef: string }): Promise<{
    token: string;
    expiresAt: string;
    repositoryId: string;
    permissions: { contents: 'write'; metadata: 'read' };
    credentialVersion: string;
  }>;
}

export interface GitWebhookVerificationPort {
  verify(input: {
    storageScopeId: string;
    repoId: string;
    webhookSecretRef: string;
    rawBody: Uint8Array;
    signature: string;
    deliveryId: string;
  }): Promise<{ valid: boolean; secretVersion?: string }>;
}

export interface GitAppOwnerRepository {
  ownerId: string;
  storageScopeId: string;
  repoId: string;
  /** Host registry value, never a browser/MCP field. */
  locator: string;
}

export const GIT_APP_PERMISSIONS = Object.freeze({ contents: 'write', metadata: 'read' } as const);
export type GitAppErrorCode = 'access_denied' | 'capability_unavailable' | 'invalid_request';
export class GitAppError extends Error {
  constructor(readonly code: GitAppErrorCode) { super(code); this.name = 'GitAppError'; }
}

export const assertGitAppPermissions = (permissions: Record<string, string>): void => {
  if (Object.keys(permissions).length !== 2 || permissions.contents !== 'write' || permissions.metadata !== 'read') {
    throw new GitAppError('capability_unavailable');
  }
};
