import {
  mountConnectorHost,
  type AccountResolver,
  type AuditPort,
  type ConnectorHostDriver,
  type ConnectorHostExposurePolicy,
  type SecretPort,
} from '@sentropic/connector-host';
import { gmailLiveAdapter } from '@sentropic/mcp-connector-google';
import type { AuthUser } from '../../middleware/auth';
import { listConnectorAccounts } from '../google-drive-connector-accounts';
import { GMAIL_PROVIDER } from '../gmail-oauth';
import {
  GOOGLE_DRIVE_ACCESS_TOKEN_SECRET,
  SecretAccessError,
  createGoogleConnectorHostAuditPort,
  createGoogleDriveSecretPort,
  createSessionTenantWorkspaceResolver,
  type GoogleDriveAccountLoader,
  type GoogleDriveConnectorAccount,
  type GoogleDriveTokenResolver,
} from './google-drive';

export const GMAIL_ACCESS_TOKEN_SECRET = GOOGLE_DRIVE_ACCESS_TOKEN_SECRET;
export { SecretAccessError };
export type GmailConnectorAccount = GoogleDriveConnectorAccount;
export type GmailAccountLoader = GoogleDriveAccountLoader;
export type GmailTokenResolver = GoogleDriveTokenResolver;

export const toGmailConnectorInstanceId = (account: Pick<GmailConnectorAccount, 'id'>): string =>
  `gmail:${account.id}`;

export const loadGmailAccounts: GmailAccountLoader = ({ userId, workspaceId }) =>
  listConnectorAccounts(workspaceId, userId, GMAIL_PROVIDER);

export const createGmailSecretPort = createGoogleDriveSecretPort;

export const GMAIL_P1_CAPABILITY_IDS = [
  'messages.get',
  'threads.get',
  'messages.list',
  'labels.list',
] as const;

const deny = (reason: string) => ({ deny: true as const, reason });

export const createGmailAccountResolver = (
  loadAccounts: GmailAccountLoader = loadGmailAccounts,
): AccountResolver => ({
  async resolve(input: Parameters<AccountResolver['resolve']>[0]) {
    if (input.connectorId !== gmailLiveAdapter.connectorId) return deny('connector_not_found');
    const accounts = (await loadAccounts({ userId: input.principalSub, workspaceId: input.workspaceRef }))
      .filter((account) => account.status === 'connected' && !!account.tokenSecret);
    const hint = input.accountSelectorHint?.trim();
    const account = hint
      ? accounts.find((candidate) => toGmailConnectorInstanceId(candidate) === hint)
      : accounts.length === 1 ? accounts[0] : undefined;
    if (!account) return deny(hint ? 'account_not_found' : 'account_ambiguous_or_missing');
    return {
      connectorInstanceId: toGmailConnectorInstanceId(account),
      enrollmentRef: `connector-account:${account.id}`,
      secretRefs: [GMAIL_ACCESS_TOKEN_SECRET],
    };
  },
});

type SessionUser = Pick<AuthUser, 'userId' | 'workspaceId'>;
type WorkspaceAccess = (userId: string, workspaceId: string) => Promise<void>;

export const createGmailConnectorHost = (options: {
  sessionUser: SessionUser;
  loadAccounts?: GmailAccountLoader;
  resolveToken?: GmailTokenResolver;
  checkWorkspaceAccess?: WorkspaceAccess;
  secretPort?: SecretPort;
  audit?: AuditPort;
}): ConnectorHostDriver => {
  const loadAccounts = options.loadAccounts ?? loadGmailAccounts;
  return mountConnectorHost({
    adapters: { [gmailLiveAdapter.connectorId]: gmailLiveAdapter },
    ports: {
      secret: options.secretPort ?? createGmailSecretPort({ loadAccounts, resolveToken: options.resolveToken }),
      account: createGmailAccountResolver(loadAccounts),
      tenantWorkspace: createSessionTenantWorkspaceResolver(
        options.sessionUser,
        options.checkWorkspaceAccess,
        GMAIL_P1_CAPABILITY_IDS,
      ),
      audit: options.audit ?? createGoogleConnectorHostAuditPort(),
    },
    exposurePolicy: {
      isCapabilityAllowed: (
        { capabilityRef }: Parameters<NonNullable<ConnectorHostExposurePolicy['isCapabilityAllowed']>>[0],
      ) =>
        (GMAIL_P1_CAPABILITY_IDS as readonly string[]).includes(capabilityRef),
    },
  });
};
