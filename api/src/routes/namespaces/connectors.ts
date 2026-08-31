import { zValidator } from '@hono/zod-validator';
import {
  type ConnectorAccountLimitAdapter,
  type ConnectorAdminProviderAdapter,
  type CreateConnectorAdminRouterOptions,
} from '@sentropic/connector-host/hono';
import { z } from 'zod';

import type { AuthUser } from '../../middleware/auth';
import {
  disconnectGmail,
  readGmailConnection,
  startGmailAdminOAuth,
  completeGmailAdminOAuthCallback,
} from '../../services/connector-host/gmail-admin';
import {
  disconnectGoogleDrive,
  readGoogleDriveConnection,
} from '../../services/connector-host/google-drive-account-admin';
import {
  completeGoogleDriveAdminOAuth,
  startGoogleDriveAdminOAuth,
} from '../../services/connector-host/google-drive-oauth-admin';
import {
  readGoogleDrivePickerConfig,
  resolveGoogleDrivePickerSelection,
} from '../../services/connector-host/google-drive-picker-admin';
import {
  CONNECTOR_ACCOUNTS_MAX_PER_PROVIDER_SETTING,
  settingsService,
} from '../../services/settings';

const connectorAccountsMaxPerProviderSchema = z.object({
  maxPerProvider: z.number().int().min(1),
});

const googleDriveAdminAdapter: ConnectorAdminProviderAdapter = {
  path: '/google-drive',
  readConnection: readGoogleDriveConnection,
  startOAuth: startGoogleDriveAdminOAuth,
  completeOAuth: completeGoogleDriveAdminOAuth,
  disconnect: disconnectGoogleDrive,
  picker: {
    readConfig: readGoogleDrivePickerConfig,
    resolveSelection: resolveGoogleDrivePickerSelection,
  },
};

const gmailAdminAdapter: ConnectorAdminProviderAdapter = {
  path: '/gmail',
  readConnection: readGmailConnection,
  startOAuth: startGmailAdminOAuth,
  completeOAuth: completeGmailAdminOAuthCallback,
  disconnect: disconnectGmail,
};

const accountLimitAdapter: ConnectorAccountLimitAdapter = {
  path: '/settings/connector-accounts/max-per-provider',
  validateUpdate: zValidator('json', connectorAccountsMaxPerProviderSchema),
  async read({ context }) {
    return context.json({
      maxPerProvider: await settingsService.getConnectorAccountsMaxPerProvider(),
    });
  },
  async update({ context }) {
    const validJson = context.req.valid as unknown as (
      target: 'json',
    ) => z.infer<typeof connectorAccountsMaxPerProviderSchema>;
    const { maxPerProvider } = validJson('json');
    await settingsService.set(
      CONNECTOR_ACCOUNTS_MAX_PER_PROVIDER_SETTING,
      maxPerProvider.toString(),
      'Maximum connector accounts per provider',
    );
    return context.json({ maxPerProvider });
  },
};

export const createProductConnectorAdminRouterOptions = (): CreateConnectorAdminRouterOptions => ({
  resolvePrincipal(context) {
    const user = context.get('user') as AuthUser | undefined;
    return user?.userId && user.workspaceId
      ? { userId: user.userId, workspaceId: user.workspaceId, role: user.role }
      : undefined;
  },
  providers: [googleDriveAdminAdapter, gmailAdminAdapter],
  accountLimits: accountLimitAdapter,
});
