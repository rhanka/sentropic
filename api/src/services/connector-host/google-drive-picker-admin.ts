import { z } from 'zod';

import { resolveGoogleDriveTokenSecret } from '../google-drive-connector-accounts';
import {
  GoogleDriveClientError,
  isSupportedGoogleDriveMimeType,
  pickGoogleDriveExportMimeType,
  resolveGoogleDriveFileMetadata,
} from '../google-drive-client';
import { buildGoogleDrivePickerConfig } from '../google-drive-picker';
import {
  connectorErrorMessage,
  ensureConnectorWorkspace,
  type ProductConnectorAdminInput,
} from './admin-utils';

const resolvePickerSelectionSchema = z.object({
  file_ids: z.array(z.string().trim().min(1)).min(1).max(20),
});

const toDriveFileResponse = (
  file: Awaited<ReturnType<typeof resolveGoogleDriveFileMetadata>>,
) => ({
  id: file.id,
  name: file.name,
  mime_type: file.mimeType,
  web_view_link: file.webViewLink,
  web_content_link: file.webContentLink,
  icon_link: file.iconLink,
  modified_time: file.modifiedTime,
  version: file.version,
  size: file.size,
  md5_checksum: file.md5Checksum,
  drive_id: file.driveId,
  supported: isSupportedGoogleDriveMimeType(file.mimeType),
  export_mime_type: pickGoogleDriveExportMimeType(file.mimeType),
});

export const readGoogleDrivePickerConfig = async (
  { context, principal }: ProductConnectorAdminInput,
): Promise<Response> => {
  if (!await ensureConnectorWorkspace(principal)) {
    return context.json({ message: 'Workspace access required' }, 403);
  }
  const token = await resolveGoogleDriveTokenSecret({
    userId: principal.userId,
    workspaceId: principal.workspaceId,
  });
  if (!token?.accessToken) {
    return context.json({ message: 'Google Drive account is not connected' }, 409);
  }
  try {
    const picker = await buildGoogleDrivePickerConfig({ oauthToken: token.accessToken });
    return context.json({
      picker: {
        client_id: picker.clientId,
        developer_key: picker.developerKey,
        app_id: picker.appId,
        oauth_token: picker.oauthToken,
        scope: picker.scope,
      },
    });
  } catch (error) {
    return context.json({
      message: connectorErrorMessage(error, 'Google Drive Picker is not configured.'),
    }, 503);
  }
};

export const resolveGoogleDrivePickerSelection = async (
  { context, principal }: ProductConnectorAdminInput,
): Promise<Response> => {
  if (!await ensureConnectorWorkspace(principal)) {
    return context.json({ message: 'Workspace access required' }, 403);
  }
  const parsed = resolvePickerSelectionSchema.safeParse(
    await context.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return context.json({ message: 'Invalid Google Drive file selection' }, 400);
  }
  const token = await resolveGoogleDriveTokenSecret({
    userId: principal.userId,
    workspaceId: principal.workspaceId,
  });
  if (!token?.accessToken) {
    return context.json({ message: 'Google Drive account is not connected' }, 409);
  }
  try {
    const files = [];
    for (const fileId of parsed.data.file_ids) {
      const file = await resolveGoogleDriveFileMetadata({
        accessToken: token.accessToken,
        fileId,
      });
      files.push(toDriveFileResponse(file));
    }
    return context.json({ files });
  } catch (error) {
    if (error instanceof GoogleDriveClientError) {
      const payload = {
        message: error.message,
        code: error.code,
        google_status: error.status ?? null,
      };
      if (error.status === 403) return context.json(payload, 403);
      if (error.status === 404) return context.json(payload, 404);
      return context.json(payload, 502);
    }
    return context.json({
      message: connectorErrorMessage(error, 'Google Drive file resolution failed'),
    }, 502);
  }
};
