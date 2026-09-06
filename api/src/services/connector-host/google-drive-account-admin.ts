import {
  disconnectGoogleDriveConnectorAccount,
  getGoogleDriveConnection,
} from '../google-drive-connector-accounts';
import {
  ensureConnectorWorkspace,
  type ProductConnectorAdminInput,
} from './admin-utils';

export const readGoogleDriveConnection = async (
  { context, principal }: ProductConnectorAdminInput,
): Promise<Response> => {
  if (!await ensureConnectorWorkspace(principal)) {
    return context.json({ message: 'Workspace access required' }, 403);
  }
  return context.json({
    account: await getGoogleDriveConnection(principal, { validateToken: true }),
  });
};

export const disconnectGoogleDrive = async (
  { context, principal }: ProductConnectorAdminInput,
): Promise<Response> => {
  if (!await ensureConnectorWorkspace(principal)) {
    return context.json({ message: 'Workspace access required' }, 403);
  }
  return context.json({
    account: await disconnectGoogleDriveConnectorAccount({
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    }),
  });
};
