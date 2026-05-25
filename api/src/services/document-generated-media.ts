import { db } from '../db/client';
import { contextDocuments } from '../db/schema';
import { createId } from '../utils/id';
import { getDocumentsBucketName, putObject } from './storage-s3';

export type GeneratedImageForDocument = {
  mimeType: string;
  data?: string;
  url?: string;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
};

export type StoreGeneratedImageDocumentInput = {
  workspaceId: string;
  sessionId: string;
  userId: string;
  toolCallId: string;
  prompt: string;
  image: GeneratedImageForDocument;
  imageIndex?: number;
  generationId?: string;
  providerId?: string;
  modelId?: string;
};

export type StoredGeneratedImageDocument = {
  documentId: string;
  fileName: string;
  mimeType: string;
  downloadUrl: string;
  width?: number;
  height?: number;
  providerId?: string;
  modelId?: string;
  prompt: string;
};

const extensionByMimeType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const normalizeMimeType = (value: unknown): string => {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : 'image/png';
};

const buildGeneratedImageFileName = (mimeType: string, imageIndex: number): string => {
  const extension = extensionByMimeType[mimeType] ?? 'png';
  const suffix = imageIndex > 0 ? `-${imageIndex + 1}` : '';
  return `generated-image${suffix}.${extension}`;
};

const createImageStorageError = (message: string): Error & { code: 'provider_failure' } => {
  const error = new Error(message) as Error & { code: 'provider_failure' };
  error.code = 'provider_failure';
  return error;
};

const decodeBase64Image = (image: GeneratedImageForDocument): Buffer => {
  const rawData = typeof image.data === 'string' ? image.data.trim() : '';
  if (!rawData) {
    throw createImageStorageError('Image generation returned an image without base64 data');
  }
  const base64 = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength === 0) {
    throw createImageStorageError('Image generation returned empty image data');
  }
  return bytes;
};

export async function storeGeneratedImageDocument(
  input: StoreGeneratedImageDocumentInput,
): Promise<StoredGeneratedImageDocument> {
  const docId = createId();
  const mimeType = normalizeMimeType(input.image.mimeType);
  const fileName = buildGeneratedImageFileName(mimeType, input.imageIndex ?? 0);
  const storageKey = `documents/${input.workspaceId}/chat_session/${input.sessionId}/${docId}-${fileName}`;
  const body = decodeBase64Image(input.image);
  const bucket = getDocumentsBucketName();

  await putObject({
    bucket,
    key: storageKey,
    body,
    contentType: mimeType,
  });

  await db.insert(contextDocuments).values({
    id: docId,
    workspaceId: input.workspaceId,
    contextType: 'chat_session',
    contextId: input.sessionId,
    filename: fileName,
    mimeType,
    sizeBytes: body.byteLength,
    sourceType: 'local',
    storageKey,
    status: 'ready',
    data: {
      summaryLang: 'fr',
      indexingSkipped: true,
      indexingSkipReason: 'generated_image',
      generatedMedia: {
        kind: 'image',
        prompt: input.prompt,
        toolCallId: input.toolCallId,
        userId: input.userId,
        generationId: input.generationId,
        providerId: input.providerId,
        modelId: input.modelId,
        width: input.image.width,
        height: input.image.height,
        metadata: input.image.metadata,
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  });

  return {
    documentId: docId,
    fileName,
    mimeType,
    downloadUrl: `/documents/${docId}/content`,
    ...(typeof input.image.width === 'number' ? { width: input.image.width } : {}),
    ...(typeof input.image.height === 'number' ? { height: input.image.height } : {}),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    prompt: input.prompt,
  };
}
