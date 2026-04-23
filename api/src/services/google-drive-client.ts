export const GOOGLE_DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';

export const GOOGLE_WORKSPACE_MIME_TYPES = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
} as const;

export type GoogleWorkspaceMimeType =
  (typeof GOOGLE_WORKSPACE_MIME_TYPES)[keyof typeof GOOGLE_WORKSPACE_MIME_TYPES];

export type GoogleDriveFileMetadata = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  webContentLink: string | null;
  iconLink: string | null;
  modifiedTime: string | null;
  version: string | null;
  size: string | null;
  md5Checksum: string | null;
  trashed: boolean;
  driveId: string | null;
};

export type GoogleDriveFileContent = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  exportMimeType: string | null;
};

export class GoogleDriveClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'GoogleDriveClientError';
  }
}

const metadataFields = [
  'id',
  'name',
  'mimeType',
  'webViewLink',
  'webContentLink',
  'iconLink',
  'modifiedTime',
  'version',
  'size',
  'md5Checksum',
  'trashed',
  'driveId',
].join(',');

const extensionByExportMimeType: Record<string, string> = {
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

const driveUrl = (path: string, params?: Record<string, string>) => {
  const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const normalizeMetadata = (value: unknown): GoogleDriveFileMetadata => {
  if (!value || typeof value !== 'object') {
    throw new GoogleDriveClientError('Google Drive returned invalid file metadata', 'invalid_metadata');
  }
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const mimeType = typeof row.mimeType === 'string' ? row.mimeType.trim() : '';
  if (!id || !name || !mimeType) {
    throw new GoogleDriveClientError('Google Drive file metadata is incomplete', 'invalid_metadata');
  }
  return {
    id,
    name,
    mimeType,
    webViewLink: typeof row.webViewLink === 'string' ? row.webViewLink : null,
    webContentLink: typeof row.webContentLink === 'string' ? row.webContentLink : null,
    iconLink: typeof row.iconLink === 'string' ? row.iconLink : null,
    modifiedTime: typeof row.modifiedTime === 'string' ? row.modifiedTime : null,
    version: typeof row.version === 'string' ? row.version : null,
    size: typeof row.size === 'string' ? row.size : null,
    md5Checksum: typeof row.md5Checksum === 'string' ? row.md5Checksum : null,
    trashed: row.trashed === true,
    driveId: typeof row.driveId === 'string' ? row.driveId : null,
  };
};

const errorMessageFromResponse = async (response: Response): Promise<string> => {
  const payload = await response.json().catch(() => null);
  const message =
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object' &&
    'message' in payload.error &&
    typeof payload.error.message === 'string'
      ? payload.error.message
      : null;
  return message ?? `Google Drive request failed with status ${response.status}`;
};

const driveFetch = async (
  input: {
    accessToken: string;
    url: string;
  },
  fetchImpl: typeof fetch,
): Promise<Response> => {
  const response = await fetchImpl(input.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
  });
  if (!response.ok) {
    throw new GoogleDriveClientError(
      await errorMessageFromResponse(response),
      'drive_request_failed',
      response.status,
    );
  }
  return response;
};

export const isGoogleWorkspaceMimeType = (mimeType: string): mimeType is GoogleWorkspaceMimeType =>
  Object.values(GOOGLE_WORKSPACE_MIME_TYPES).includes(mimeType as GoogleWorkspaceMimeType);

export const pickGoogleDriveExportMimeType = (mimeType: string): string | null => {
  if (mimeType === GOOGLE_WORKSPACE_MIME_TYPES.document) return 'text/markdown';
  if (mimeType === GOOGLE_WORKSPACE_MIME_TYPES.spreadsheet) return 'text/csv';
  if (mimeType === GOOGLE_WORKSPACE_MIME_TYPES.presentation) return 'text/plain';
  return null;
};

export const resolveGoogleDriveFileMetadata = async (input: {
  accessToken: string;
  fileId: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleDriveFileMetadata> => {
  const fileId = input.fileId.trim();
  if (!fileId) throw new GoogleDriveClientError('Google Drive file id is required', 'missing_file_id');
  const response = await driveFetch(
    {
      accessToken: input.accessToken,
      url: driveUrl(`/files/${encodeURIComponent(fileId)}`, {
        fields: metadataFields,
        supportsAllDrives: 'true',
      }),
    },
    input.fetchImpl ?? fetch,
  );
  return normalizeMetadata(await response.json());
};

export const loadGoogleDriveFileContent = async (input: {
  accessToken: string;
  file: GoogleDriveFileMetadata;
  fetchImpl?: typeof fetch;
}): Promise<GoogleDriveFileContent> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const exportMimeType = pickGoogleDriveExportMimeType(input.file.mimeType);
  const response = await driveFetch(
    {
      accessToken: input.accessToken,
      url: exportMimeType
        ? driveUrl(`/files/${encodeURIComponent(input.file.id)}/export`, {
            mimeType: exportMimeType,
          })
        : driveUrl(`/files/${encodeURIComponent(input.file.id)}`, {
            alt: 'media',
            supportsAllDrives: 'true',
          }),
    },
    fetchImpl,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const outputMimeType =
    exportMimeType ?? response.headers.get('content-type') ?? input.file.mimeType;
  const extension = exportMimeType ? extensionByExportMimeType[exportMimeType] : null;
  const fileName =
    exportMimeType && extension && !input.file.name.toLowerCase().endsWith(`.${extension}`)
      ? `${input.file.name}.${extension}`
      : input.file.name;

  return {
    bytes,
    fileName,
    mimeType: outputMimeType,
    exportMimeType,
  };
};
