export const GOOGLE_DRIVE_CONNECTORS_ID = 'google-drive-connectors';
export const GOOGLE_DRIVE_CONNECTORS_HASH = `#${GOOGLE_DRIVE_CONNECTORS_ID}`;
export const GOOGLE_DRIVE_CONNECTORS_ROUTE = `/settings${GOOGLE_DRIVE_CONNECTORS_HASH}`;

export const GOOGLE_DRIVE_CONNECTION_UPDATED_EVENT =
  'google-drive-connection-updated';

export const emitGoogleDriveConnectionUpdated = (detail: {
  connected: boolean;
}): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(GOOGLE_DRIVE_CONNECTION_UPDATED_EVENT, {
      detail,
    }),
  );
};

export const scrollToGoogleDriveConnectors = (): void => {
  if (typeof document === 'undefined') return;
  const target = document.getElementById(GOOGLE_DRIVE_CONNECTORS_ID);
  if (!(target instanceof HTMLElement)) return;
  target.scrollIntoView({ behavior: 'auto', block: 'start' });
  target.focus({ preventScroll: true });
};
