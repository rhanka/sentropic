/**
 * BR-72 Wave-1 benchmark proof — SYNTHETIC Dropbox fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

const README_CONTENT_BASE64 = Buffer.from(
  '# Synthetic demo Dropbox file fixture.\n',
  'utf8',
).toString('base64');

export const dropboxFixtures = {
  resources: {
    get_current_account: {
      accountId: 'dbid:demo-sentropic-account',
      displayName: 'Sentropic Demo User',
      email: 'demo-user@example.invalid',
      emailVerified: true,
      disabled: false,
      accountType: 'business',
      country: 'CA',
    },
    get_metadata: {
      tag: 'file',
      name: 'README.md',
      id: 'id:demoFileId0001',
      pathDisplay: '/Demo Folder/README.md',
      pathLower: '/demo folder/readme.md',
      serverModified: '2026-07-01T12:00:00Z',
      rev: '0123456789abcdef',
      sizeBytes: 512,
    },
    download_file: {
      path: '/Demo Folder/README.md',
      name: 'README.md',
      mimeType: 'text/markdown',
      sizeBytes: 40,
      contentBase64: README_CONTENT_BASE64,
    },
    get_shared_link_metadata: {
      tag: 'file',
      url: 'https://www.dropbox.com/s/demo-share-link/README.md?dl=0',
      name: 'README.md',
      pathLower: '/demo folder/readme.md',
      linkPermissions: { resolvedVisibility: 'public' },
      expiresAt: null,
    },
  },
  tools: {
    list_folder: {
      entries: [
        {
          tag: 'folder',
          name: 'Demo Folder',
          id: 'id:demoFolderId0001',
          pathDisplay: '/Demo Folder',
        },
        {
          tag: 'file',
          name: 'README.md',
          id: 'id:demoFileId0001',
          pathDisplay: '/Demo Folder/README.md',
          sizeBytes: 512,
        },
      ],
      cursor: 'demo-folder-cursor-0001',
      hasMore: false,
    },
    search_files: {
      matches: [
        {
          tag: 'file',
          name: 'README.md',
          id: 'id:demoFileId0001',
          pathDisplay: '/Demo Folder/README.md',
        },
      ],
      cursor: 'demo-search-cursor-0001',
      hasMore: false,
    },
    list_shared_links: {
      links: [
        {
          tag: 'file',
          url: 'https://www.dropbox.com/s/demo-share-link/README.md?dl=0',
          name: 'README.md',
        },
      ],
      cursor: null,
      hasMore: false,
    },
    list_revisions: {
      isDeleted: false,
      entries: [
        {
          tag: 'file',
          name: 'README.md',
          rev: '0123456789abcdef',
          serverModified: '2026-07-01T12:00:00Z',
          sizeBytes: 512,
        },
        {
          tag: 'file',
          name: 'README.md',
          rev: 'abcdef0123456789',
          serverModified: '2026-06-01T12:00:00Z',
          sizeBytes: 480,
        },
      ],
    },
  },
} as const;

export type DropboxResourceCapabilityName = keyof typeof dropboxFixtures.resources;
export type DropboxToolCapabilityName = keyof typeof dropboxFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (dropboxFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (dropboxFixtures.tools as Record<string, unknown>)[capabilityRef];
}
