import {
  mountConnectorHost,
  type AccountResolver,
  type AuditPort,
  type ConnectorHostDriver,
  type SecretPort,
  type TenantWorkspaceResolver,
} from '@sentropic/connector-host';
import { googleDriveLiveAdapter } from '@sentropic/mcp-connector-google';
import type { AuthUser } from '../../middleware/auth';
import { requireWorkspaceAccess } from '../workspace-access';
import { GOOGLE_DRIVE_PROVIDER } from '../google-drive-oauth';
import {
  listConnectorAccounts,
  resolveGoogleDriveTokenSecretByAccountId,
  type GoogleDriveTokenSecretPayload,
} from '../google-drive-connector-accounts';
import { decryptSecret } from '../secret-crypto';

export const GOOGLE_DRIVE_ACCESS_TOKEN_SECRET = 'googleOAuthAccessToken';

export type GoogleDriveConnectorAccount = {
  id: string;
  status: string;
  tokenSecret: string | null;
  accountSubject: string | null;
};

export type GoogleDriveAccountLoader = (input: {
  userId: string;
  workspaceId: string;
}) => Promise<GoogleDriveConnectorAccount[]>;

export type GoogleDriveTokenResolver = (input: {
  connectorAccountId: string;
}) => Promise<GoogleDriveTokenSecretPayload | null>;

/** Safe, opaque code used only to re-identify a selected connector account. */
export const toGoogleDriveConnectorInstanceId = (account: Pick<GoogleDriveConnectorAccount, 'id'>): string =>
  `google-drive:${account.id}`;

export class SecretAccessError extends Error {
  readonly reason: 'not_enrolled' | 'secret_not_active' | 'unsupported_secret';

  constructor(reason: SecretAccessError['reason']) {
    super('Connector secret is unavailable.');
    this.name = 'SecretAccessError';
    this.reason = reason;
  }
}

export const loadGoogleDriveAccounts: GoogleDriveAccountLoader = ({ userId, workspaceId }) =>
  listConnectorAccounts(workspaceId, userId, GOOGLE_DRIVE_PROVIDER);

const resolveGoogleDriveToken: GoogleDriveTokenResolver = ({ connectorAccountId }) =>
  resolveGoogleDriveTokenSecretByAccountId({ connectorAccountId });

export const createGoogleDriveSecretPort = (
  dependencies: {
    loadAccounts?: GoogleDriveAccountLoader;
    resolveToken?: GoogleDriveTokenResolver;
  } = {},
): SecretPort => {
  const loadAccounts = dependencies.loadAccounts ?? loadGoogleDriveAccounts;
  const resolveToken = dependencies.resolveToken ?? resolveGoogleDriveToken;

  return {
    async resolve(request): Promise<string> {
      if (request.secretName !== GOOGLE_DRIVE_ACCESS_TOKEN_SECRET) {
        throw new SecretAccessError('unsupported_secret');
      }

      const accounts = await loadAccounts({
        userId: request.principalSub,
        workspaceId: request.workspaceRef,
      });
      const account = accounts.find(
        (candidate) => toGoogleDriveConnectorInstanceId(candidate) === request.connectorInstanceId,
      );
      if (!account) throw new SecretAccessError('not_enrolled');
      if (account.status !== 'connected' || !account.tokenSecret) {
        throw new SecretAccessError('secret_not_active');
      }

      // Deliberately preflight with the throwing primitive. The legacy public resolver below must
      // retain its null-return contract for documents.ts, while this egress boundary preserves the
      // exact SecretEnvelopeError shape required by the Google adapter's two-code contract.
      decryptSecret(account.tokenSecret);

      // The existing account-specific resolver owns refresh-on-near-expiry and its DB update.
      // It is safe only after the throwing preflight above: an unreadable envelope must never be
      // collapsed into its historical null result on this connector-host path.
      const token = await resolveToken({ connectorAccountId: account.id });
      if (!token?.accessToken) throw new SecretAccessError('secret_not_active');
      return token.accessToken;
    },
  };
};

export const GOOGLE_DRIVE_P1_CAPABILITY_IDS = [
  'about.get',
  'files.get',
  'files.list',
  'files.export',
  'permissions.list',
] as const;

const deny = (reason: string) => ({ deny: true as const, reason });

export const createGoogleDriveAccountResolver = (
  loadAccounts: GoogleDriveAccountLoader = loadGoogleDriveAccounts,
): AccountResolver => ({
  async resolve(input) {
    if (input.connectorId !== googleDriveLiveAdapter.connectorId) return deny('connector_not_found');
    const accounts = (await loadAccounts({ userId: input.principalSub, workspaceId: input.workspaceRef }))
      .filter((account) => account.status === 'connected' && !!account.tokenSecret);
    const hint = input.accountSelectorHint?.trim();
    const account = hint
      ? accounts.find((candidate) => toGoogleDriveConnectorInstanceId(candidate) === hint)
      : accounts.length === 1 ? accounts[0] : undefined;
    if (!account) return deny(hint ? 'account_not_found' : 'account_ambiguous_or_missing');
    return {
      connectorInstanceId: toGoogleDriveConnectorInstanceId(account),
      enrollmentRef: `connector-account:${account.id}`,
      secretRefs: [GOOGLE_DRIVE_ACCESS_TOKEN_SECRET],
    };
  },
});

type SessionUser = Pick<AuthUser, 'userId' | 'workspaceId'>;
type WorkspaceAccess = (userId: string, workspaceId: string) => Promise<void>;

const hintedPrincipal = (hints: Record<string, unknown> | undefined): unknown =>
  ['principal', 'principalRef', 'principalSub', 'sessionPrincipalSub', 'sub']
    .map((key) => hints?.[key])
    .find((value) => value !== undefined);

export const createSessionTenantWorkspaceResolver = (
  sessionUser: SessionUser,
  checkWorkspaceAccess: WorkspaceAccess = requireWorkspaceAccess,
): TenantWorkspaceResolver => ({
  async resolve(input) {
    const requestedPrincipal = hintedPrincipal(input.hints);
    if (
      !sessionUser.userId ||
      input.sessionPrincipalSub !== sessionUser.userId ||
      (requestedPrincipal !== undefined && requestedPrincipal !== sessionUser.userId)
    ) return deny('principal_mismatch');

    const workspaceRef = input.requestedWorkspaceRef ?? sessionUser.workspaceId;
    if (!workspaceRef || (typeof input.hints?.workspaceRef === 'string' && input.hints.workspaceRef !== workspaceRef)) {
      return deny('workspace_mismatch');
    }
    try {
      await checkWorkspaceAccess(sessionUser.userId, workspaceRef);
    } catch {
      return deny('workspace_access_denied');
    }
    return {
      principalSub: sessionUser.userId,
      tenantRef: workspaceRef,
      workspaceRef,
      exposure: { capabilityIds: [...GOOGLE_DRIVE_P1_CAPABILITY_IDS] },
    };
  },
});

/** P1 has no durable audit store; the mount still emits only redacted, name-only events. */
export const createGoogleConnectorHostAuditPort = (): AuditPort => ({ emit: async () => undefined });

export const createGoogleConnectorHost = (options: {
  sessionUser: SessionUser;
  loadAccounts?: GoogleDriveAccountLoader;
  resolveToken?: GoogleDriveTokenResolver;
  checkWorkspaceAccess?: WorkspaceAccess;
  secretPort?: SecretPort;
  audit?: AuditPort;
}): ConnectorHostDriver => {
  const loadAccounts = options.loadAccounts ?? loadGoogleDriveAccounts;
  return mountConnectorHost({
    adapters: { [googleDriveLiveAdapter.connectorId]: googleDriveLiveAdapter },
    ports: {
      secret: options.secretPort ?? createGoogleDriveSecretPort({ loadAccounts, resolveToken: options.resolveToken }),
      account: createGoogleDriveAccountResolver(loadAccounts),
      tenantWorkspace: createSessionTenantWorkspaceResolver(options.sessionUser, options.checkWorkspaceAccess),
      audit: options.audit ?? createGoogleConnectorHostAuditPort(),
    },
    exposurePolicy: {
      isCapabilityAllowed: ({ capabilityRef }) =>
        (GOOGLE_DRIVE_P1_CAPABILITY_IDS as readonly string[]).includes(capabilityRef),
    },
  });
};
