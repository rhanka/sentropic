import type { SecretPort } from '@sentropic/connector-host';
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

const loadGoogleDriveAccounts: GoogleDriveAccountLoader = ({ userId, workspaceId }) =>
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
