import type { GoogleDriveConnection } from './google-drive';

export type DocumentSourceGoogleDriveMode = 'connected' | 'loading' | 'manage';

export const resolveGoogleDriveAccountLabel = (input: {
  accountEmail?: string | null;
  accountSubject?: string | null;
}): string | null => input.accountEmail ?? input.accountSubject ?? null;

export const resolveDocumentSourceGoogleDriveMode = (input: {
  ready: boolean;
  connected: boolean;
  busy: boolean;
}): DocumentSourceGoogleDriveMode => {
  if (input.connected) return 'connected';
  if (!input.ready || input.busy) return 'loading';
  return 'manage';
};

export const resolveGoogleDriveConnectorCardState = (
  connection: GoogleDriveConnection | null | undefined,
): {
  connected: boolean;
  accountLabel: string | null;
} => ({
  connected: Boolean(connection?.connected),
  accountLabel: resolveGoogleDriveAccountLabel({
    accountEmail: connection?.accountEmail,
    accountSubject: connection?.accountSubject,
  }),
});
