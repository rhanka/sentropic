/** Synthetic, non-production Google Drive and Gmail capability outputs. */
export const googleFixtures = {
  googleDrive: {
    resources: {
      'about.get': {
        user: { displayName: 'Synthetic Drive Account', permissionId: 'fixture-user' },
        storageQuota: { limit: '1073741824', usage: '4096' },
      },
      'files.get': {
        id: 'fixture-drive-file-1',
        name: 'Synthetic planning note',
        mimeType: 'application/vnd.google-apps.document',
        webViewLink: null,
        webContentLink: null,
        iconLink: null,
        modifiedTime: '2026-01-01T00:00:00.000Z',
        version: '1',
        size: null,
        md5Checksum: null,
        trashed: false,
        driveId: null,
      },
    },
    tools: {
      'files.list': {
        files: [{ id: 'fixture-drive-file-1', name: 'Synthetic planning note' }],
        nextPageToken: null,
      },
      'files.export': {
        fileName: 'Synthetic planning note.md',
        mimeType: 'text/markdown',
        exportMimeType: 'text/markdown',
        content: '# Synthetic planning note\n',
      },
      'permissions.list': {
        permissions: [{ id: 'fixture-permission-1', type: 'user', role: 'reader' }],
      },
    },
  },
  gmail: {
    resources: {
      'messages.get': {
        id: 'fixture-message-1',
        threadId: 'fixture-thread-1',
        labelIds: ['INBOX'],
        snippet: 'Synthetic inbox message.',
      },
      'threads.get': {
        id: 'fixture-thread-1',
        messages: [{ id: 'fixture-message-1', snippet: 'Synthetic inbox message.' }],
      },
    },
    tools: {
      'messages.list': {
        messages: [{ id: 'fixture-message-1', threadId: 'fixture-thread-1' }],
        nextPageToken: null,
      },
      'labels.list': {
        labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }],
      },
    },
  },
} as const;

export type GoogleProvider = keyof typeof googleFixtures;

export function getResourceFixture(provider: GoogleProvider, capabilityRef: string): unknown | undefined {
  return (googleFixtures[provider].resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(provider: GoogleProvider, capabilityRef: string): unknown | undefined {
  return (googleFixtures[provider].tools as Record<string, unknown>)[capabilityRef];
}
