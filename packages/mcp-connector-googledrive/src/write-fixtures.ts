/**
 * BR-72 Wave-2 Lot 2 — SYNTHETIC Google Drive write-tool fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the write adapter can return a
 * canned "mutation succeeded" output once `assertMutationGate` clears an
 * invocation — no real Google Drive API is ever reached.
 */

export const googleDriveWriteFixtures = {
  tools: {
    'files.create': {
      id: 'file-new-0001',
      name: 'demo-new-file.txt',
      mimeType: 'text/plain',
      parents: ['root'],
      webViewLink: 'https://drive.google.com/file/d/file-new-0001/view',
    },
    'files.update': {
      id: 'file-doc-1',
      name: 'Project Plan (updated)',
      mimeType: 'application/vnd.google-apps.document',
      modifiedTime: '2026-07-19T00:00:00.000Z',
    },
    'files.copy': {
      id: 'file-copy-0001',
      name: 'Project Plan (copy)',
      mimeType: 'application/vnd.google-apps.document',
      parents: ['root'],
    },
    'permissions.create': {
      id: 'perm-new-0001',
      role: 'reader',
      type: 'user',
      emailAddress: 'bob@example.com',
    },
    'files.delete': {
      deleted: true,
      fileId: 'file-doc-1',
    },
    'drives.create': {
      id: 'drive-new-0001',
      name: 'Synthetic demo shared drive',
      capabilities: { canAddChildren: true },
    },
  },
} as const;

export type GoogleDriveWriteToolCapabilityName = keyof typeof googleDriveWriteFixtures.tools;

export function getWriteToolFixture(capabilityRef: string): unknown | undefined {
  return (googleDriveWriteFixtures.tools as Record<string, unknown>)[capabilityRef];
}
