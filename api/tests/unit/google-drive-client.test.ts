import { describe, expect, it, vi } from 'vitest';
import {
  GoogleDriveClientError,
  GOOGLE_WORKSPACE_MIME_TYPES,
  isSupportedGoogleDriveMimeType,
  loadGoogleDriveFileContent,
  pickGoogleDriveExportMimeType,
  resolveGoogleDriveFileMetadata,
} from '../../src/services/google-drive-client';

const makeFetchResponse = (body: unknown, init?: ResponseInit) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

describe('google drive client', () => {
  it('resolves file metadata with narrow fields and bearer auth', async () => {
    const fetchImpl = vi.fn(async () =>
      makeFetchResponse({
        id: 'file_1',
        name: 'Roadmap',
        mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
        webViewLink: 'https://docs.google.com/document/d/file_1',
        modifiedTime: '2026-04-22T12:00:00.000Z',
        version: '42',
        trashed: false,
      }),
    );

    const file = await resolveGoogleDriveFileMetadata({
      accessToken: 'access-token',
      fileId: 'file_1',
      fetchImpl,
    });

    expect(file).toMatchObject({
      id: 'file_1',
      name: 'Roadmap',
      mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
      webViewLink: 'https://docs.google.com/document/d/file_1',
      version: '42',
      trashed: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/drive/v3/files/file_1?');
    expect(String(url)).toContain('supportsAllDrives=true');
    expect(String(url)).toContain('fields=');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
  });

  it('maps Google Workspace MIME types to text export formats', () => {
    expect(pickGoogleDriveExportMimeType(GOOGLE_WORKSPACE_MIME_TYPES.document)).toBe(
      'text/markdown',
    );
    expect(pickGoogleDriveExportMimeType(GOOGLE_WORKSPACE_MIME_TYPES.spreadsheet)).toBe(
      'text/csv',
    );
    expect(pickGoogleDriveExportMimeType(GOOGLE_WORKSPACE_MIME_TYPES.presentation)).toBe(
      'text/plain',
    );
    expect(
      pickGoogleDriveExportMimeType(GOOGLE_WORKSPACE_MIME_TYPES.document, 'download'),
    ).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(
      pickGoogleDriveExportMimeType(GOOGLE_WORKSPACE_MIME_TYPES.spreadsheet, 'download'),
    ).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(
      pickGoogleDriveExportMimeType(GOOGLE_WORKSPACE_MIME_TYPES.presentation, 'download'),
    ).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(pickGoogleDriveExportMimeType('application/pdf')).toBeNull();
  });

  it('identifies supported Google Drive source MIME types', () => {
    expect(isSupportedGoogleDriveMimeType(GOOGLE_WORKSPACE_MIME_TYPES.presentation)).toBe(true);
    expect(isSupportedGoogleDriveMimeType('application/pdf')).toBe(true);
    expect(isSupportedGoogleDriveMimeType('text/markdown')).toBe(true);
    expect(isSupportedGoogleDriveMimeType('application/vnd.google-apps.folder')).toBe(false);
  });

  it('exports native Google Workspace files instead of downloading media', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('# Roadmap\n\nMilestone', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      }),
    );

    const content = await loadGoogleDriveFileContent({
      accessToken: 'access-token',
      file: {
        id: 'file_1',
        name: 'Roadmap',
        mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
        webViewLink: null,
        webContentLink: null,
        iconLink: null,
        modifiedTime: null,
        version: null,
        size: null,
        md5Checksum: null,
        trashed: false,
        driveId: null,
      },
      fetchImpl,
    });

    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/drive/v3/files/file_1/export?');
    expect(String(url)).toContain('mimeType=text%2Fmarkdown');
    expect(content.fileName).toBe('Roadmap.md');
    expect(content.mimeType).toBe('text/markdown');
    expect(content.exportMimeType).toBe('text/markdown');
    expect(new TextDecoder().decode(content.bytes)).toContain('Milestone');
  });

  it('exports native Google Workspace files to Office formats for user downloads', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      }),
    );

    const content = await loadGoogleDriveFileContent({
      accessToken: 'access-token',
      purpose: 'download',
      file: {
        id: 'file_1',
        name: 'Roadmap',
        mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
        webViewLink: null,
        webContentLink: null,
        iconLink: null,
        modifiedTime: null,
        version: null,
        size: null,
        md5Checksum: null,
        trashed: false,
        driveId: null,
      },
      fetchImpl,
    });

    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/drive/v3/files/file_1/export?');
    expect(String(url)).toContain(
      'mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(content.fileName).toBe('Roadmap.docx');
    expect(content.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(content.exportMimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect([...content.bytes]).toEqual([80, 75, 3, 4]);
  });

  it('downloads non-native files as transient media bytes', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );

    const content = await loadGoogleDriveFileContent({
      accessToken: 'access-token',
      file: {
        id: 'pdf_1',
        name: 'brief.pdf',
        mimeType: 'application/pdf',
        webViewLink: null,
        webContentLink: null,
        iconLink: null,
        modifiedTime: null,
        version: null,
        size: '3',
        md5Checksum: null,
        trashed: false,
        driveId: null,
      },
      fetchImpl,
    });

    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/drive/v3/files/pdf_1?');
    expect(String(url)).toContain('alt=media');
    expect(content.fileName).toBe('brief.pdf');
    expect(content.mimeType).toBe('application/pdf');
    expect(content.exportMimeType).toBeNull();
    expect([...content.bytes]).toEqual([1, 2, 3]);
  });

  it('throws a typed error for failed Drive API responses', async () => {
    const fetchImpl = vi.fn(async () =>
      makeFetchResponse(
        { error: { message: 'File not found' } },
        { status: 404, statusText: 'Not Found' },
      ),
    );

    await expect(
      resolveGoogleDriveFileMetadata({
        accessToken: 'access-token',
        fileId: 'missing',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: 'GoogleDriveClientError',
      code: 'drive_request_failed',
      status: 404,
      message: 'File not found',
    } satisfies Partial<GoogleDriveClientError>);
  });
});
