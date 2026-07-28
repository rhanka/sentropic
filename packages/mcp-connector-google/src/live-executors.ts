/** REAL-network Google Drive and Gmail read-only capability executors. */

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const INVALID_SEGMENT_VALUES = new Set(['', '.', '..']);

export class GoogleLiveApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retriable: boolean;

  constructor(status: number, code: string, message: string, retriable: boolean) {
    super(message);
    this.name = 'GoogleLiveApiError';
    this.status = status;
    this.code = code;
    this.retriable = retriable;
  }
}

function invalidInput(message: string): never {
  throw new GoogleLiveApiError(400, 'google_invalid_input', message, false);
}

function requiredString(input: unknown, field: string): string {
  const value = (input as Record<string, unknown> | null | undefined)?.[field];
  if (typeof value !== 'string' || value === '') {
    invalidInput(`${field} must be a non-empty string.`);
  }
  return value;
}

function validIdSegment(input: unknown, field: string): string {
  const value = requiredString(input, field);
  if (INVALID_SEGMENT_VALUES.has(value)) {
    invalidInput(`Invalid ${field} segment.`);
  }
  return value;
}

function optionalQuery(input: unknown): string | undefined {
  const value = (input as Record<string, unknown> | null | undefined)?.query;
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') invalidInput('query must be a string.');
  return value;
}

function queryString(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value!)}`)
    .join('&');
}

function headers(token: string): Record<string, string> {
  const result: Record<string, string> = { Accept: 'application/json' };
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

async function googleFetch(base: string, path: string, token: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      headers: headers(token),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const isTimeout = name === 'AbortError' || name === 'TimeoutError';
    throw new GoogleLiveApiError(
      0,
      isTimeout ? 'google_request_timeout' : 'google_transport_error',
      isTimeout ? 'Google API request timed out.' : 'Google API transport failure.',
      true,
    );
  }

  if (!response.ok) {
    throw new GoogleLiveApiError(
      response.status,
      `google_api_error_${response.status}`,
      `Google API request failed with status ${response.status}.`,
      response.status === 429 || response.status >= 500,
    );
  }
  return response.json();
}

export type DriveFileInput = { fileId: string };
export type DriveFilesListInput = { query?: string };
export type DriveFilesExportInput = { fileId: string; mimeType: string };
export type GmailMessageInput = { messageId: string };
export type GmailThreadInput = { threadId: string };
export type GmailMessagesListInput = { query?: string };

/** GET /about?fields=... */
export async function getDriveAboutLive(token: string): Promise<unknown> {
  const fields = 'user(emailAddress,displayName,permissionId),storageQuota';
  return googleFetch(
    GOOGLE_DRIVE_API_BASE,
    `/about?${queryString({ fields })}`,
    token,
  );
}

/** GET /files. */
export async function listDriveFilesLive(input: DriveFilesListInput, token: string): Promise<unknown> {
  const query = optionalQuery(input);
  const suffix = query === undefined ? '' : `?${queryString({ q: query })}`;
  return googleFetch(GOOGLE_DRIVE_API_BASE, `/files${suffix}`, token);
}

/** GET /files/{fileId}. */
export async function getDriveFileLive(input: DriveFileInput, token: string): Promise<unknown> {
  const fileId = validIdSegment(input, 'fileId');
  return googleFetch(GOOGLE_DRIVE_API_BASE, `/files/${encodeURIComponent(fileId)}`, token);
}

/** GET /files/{fileId}/export?mimeType=... */
export async function exportDriveFileLive(
  input: DriveFilesExportInput,
  token: string,
): Promise<unknown> {
  const fileId = validIdSegment(input, 'fileId');
  const mimeType = requiredString(input, 'mimeType');
  return googleFetch(
    GOOGLE_DRIVE_API_BASE,
    `/files/${encodeURIComponent(fileId)}/export?${queryString({ mimeType })}`,
    token,
  );
}

/** GET /files/{fileId}/permissions. */
export async function listDrivePermissionsLive(
  input: DriveFileInput,
  token: string,
): Promise<unknown> {
  const fileId = validIdSegment(input, 'fileId');
  return googleFetch(GOOGLE_DRIVE_API_BASE, `/files/${encodeURIComponent(fileId)}/permissions`, token);
}

/** GET /messages. */
export async function listGmailMessagesLive(
  input: GmailMessagesListInput,
  token: string,
): Promise<unknown> {
  const query = optionalQuery(input);
  const suffix = query === undefined ? '' : `?${queryString({ q: query })}`;
  return googleFetch(GMAIL_API_BASE, `/messages${suffix}`, token);
}

/** GET /messages/{id}. */
export async function getGmailMessageLive(
  input: GmailMessageInput,
  token: string,
): Promise<unknown> {
  const messageId = validIdSegment(input, 'messageId');
  return googleFetch(GMAIL_API_BASE, `/messages/${encodeURIComponent(messageId)}`, token);
}

/** GET /threads/{id}. */
export async function getGmailThreadLive(input: GmailThreadInput, token: string): Promise<unknown> {
  const threadId = validIdSegment(input, 'threadId');
  return googleFetch(GMAIL_API_BASE, `/threads/${encodeURIComponent(threadId)}`, token);
}

/** GET /labels. */
export async function listGmailLabelsLive(token: string): Promise<unknown> {
  return googleFetch(GMAIL_API_BASE, '/labels', token);
}
