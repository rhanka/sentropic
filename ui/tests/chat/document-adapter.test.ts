import { describe, expect, it } from 'vitest';
import {
  createChatSessionCreatePayload,
  createChatSessionDocumentContext,
  createGoogleDriveChatAttachInput,
  extractGeneratedFileCardsFromEvents,
  extractGeneratedFileCardsFromRuntimeSummary,
  getGeneratedFileFormatLabel,
  getSessionDocumentStatusLabelKey,
  normalizeGeneratedFileCard,
} from '$lib/chat/document-adapter';

describe('chat document adapter', () => {
  it('builds chat-session document payloads for local and Google Drive sources', () => {
    expect(createChatSessionDocumentContext('sess_1', 'ws_1')).toEqual({
      contextType: 'chat_session',
      contextId: 'sess_1',
      workspaceId: 'ws_1',
    });
    expect(
      createChatSessionCreatePayload({
        primaryContextType: 'folder',
        primaryContextId: 'fld_1',
      }),
    ).toEqual({ primaryContextType: 'folder', primaryContextId: 'fld_1' });
    expect(createGoogleDriveChatAttachInput('sess_1', ['file_1', 'file_2'])).toEqual({
      contextType: 'chat_session',
      contextId: 'sess_1',
      fileIds: ['file_1', 'file_2'],
    });
  });

  it('normalizes generated file cards from sparse runtime payloads', () => {
    expect(
      normalizeGeneratedFileCard({
        jobId: 'job_1',
        fileName: 'deck.pptx',
        format: ' PPTX ',
        mimeType: ' application/vnd.pptx ',
        downloadUrl: ' /pptx/jobs/job_1/download ',
      }),
    ).toEqual({
      jobId: 'job_1',
      fileName: 'deck.pptx',
      format: 'pptx',
      mimeType: 'application/vnd.pptx',
      downloadUrl: '/pptx/jobs/job_1/download',
    });

    expect(
      normalizeGeneratedFileCard({ jobId: 'job_2', fileName: 'brief' }).format,
    ).toBe('docx');
  });

  it('extracts generated cards from runtime summaries before legacy docx cards', () => {
    expect(
      extractGeneratedFileCardsFromRuntimeSummary({
        generatedFileCards: [
          { jobId: 'job_1', fileName: 'deck.pptx', format: 'pptx' },
        ],
        docxCards: [{ jobId: 'job_legacy', fileName: 'legacy.docx' }],
      }),
    ).toEqual([{ jobId: 'job_1', fileName: 'deck.pptx', format: 'pptx' }]);

    expect(
      extractGeneratedFileCardsFromRuntimeSummary({
        docxCards: [{ jobId: 'job_legacy', fileName: 'legacy.docx' }],
      }),
    ).toEqual([{ jobId: 'job_legacy', fileName: 'legacy.docx', format: 'docx' }]);
  });

  it('extracts generated cards from completed document_generate tool events', () => {
    expect(
      extractGeneratedFileCardsFromEvents([
        {
          eventType: 'tool_call_start',
          data: { tool_call_id: 'call_1', name: 'document_generate' },
        },
        {
          eventType: 'tool_call_result',
          data: {
            tool_call_id: 'call_1',
            result: {
              status: 'completed',
              jobId: 'job_1',
              fileName: 'summary.docx',
              format: 'docx',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              downloadUrl: '/docx/jobs/job_1/download',
            },
          },
        },
        {
          eventType: 'tool_call_result',
          data: {
            tool_call_id: 'call_2',
            result: { status: 'completed', jobId: 'ignored', fileName: 'ignored.docx' },
          },
        },
      ]),
    ).toEqual([
      {
        jobId: 'job_1',
        fileName: 'summary.docx',
        format: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        downloadUrl: '/docx/jobs/job_1/download',
      },
    ]);
  });

  it('extracts generated cards from completed image_generate tool events', () => {
    expect(
      extractGeneratedFileCardsFromEvents([
        {
          eventType: 'tool_call_start',
          data: { tool_call_id: 'img_1', name: 'image_generate' },
        },
        {
          eventType: 'tool_call_result',
          data: {
            tool_call_id: 'img_1',
            result: {
              status: 'completed',
              media: [
                {
                  documentId: 'doc_1',
                  fileName: 'generated-image-1.png',
                  mimeType: 'image/png',
                  width: 1024,
                  height: 1024,
                  providerId: 'openai',
                  modelId: 'gpt-image-2',
                  prompt: 'A concise mockup',
                  downloadUrl: '/documents/doc_1/content',
                },
              ],
            },
          },
        },
      ]),
    ).toEqual([
      {
        jobId: 'doc_1',
        fileName: 'generated-image-1.png',
        format: undefined,
        mimeType: 'image/png',
        downloadUrl: '/documents/doc_1/content',
        kind: 'image',
        documentId: 'doc_1',
        previewUrl: '/documents/doc_1/content',
        providerId: 'openai',
        modelId: 'gpt-image-2',
        prompt: 'A concise mockup',
      },
    ]);
  });

  it('builds document download URLs for generated image cards that only carry a document id', () => {
    expect(
      normalizeGeneratedFileCard({
        kind: 'image',
        jobId: 'doc_2',
        documentId: 'doc_2',
        fileName: 'generated-image-2.png',
        mimeType: 'image/png',
      }),
    ).toMatchObject({
      kind: 'image',
      documentId: 'doc_2',
      downloadUrl: '/documents/doc_2/content',
      previewUrl: '/documents/doc_2/content',
    });
  });

  it('ignores untrusted generated image URLs and keeps the document endpoint', () => {
    expect(
      normalizeGeneratedFileCard({
        kind: 'image',
        jobId: 'doc_3',
        documentId: 'doc_3',
        fileName: 'generated-image-3.png',
        downloadUrl: 'https://attacker.example/collect',
        previewUrl: '//attacker.example/pixel.png',
      }),
    ).toMatchObject({
      kind: 'image',
      documentId: 'doc_3',
      downloadUrl: '/documents/doc_3/content',
      previewUrl: '/documents/doc_3/content',
    });
  });

  it('maps document UI labels without coupling the adapter to i18n', () => {
    expect(getGeneratedFileFormatLabel('pptx')).toBe('PPTX');
    expect(getGeneratedFileFormatLabel(undefined)).toBe('FILE');
    expect(getSessionDocumentStatusLabelKey('ready')).toBe('chat.documents.status.ready');
    expect(getSessionDocumentStatusLabelKey('unknown_state')).toBe('chat.documents.status.unknown');
  });
});
