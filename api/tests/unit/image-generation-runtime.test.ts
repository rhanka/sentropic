import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openaiImagesGenerate = vi.fn();

vi.mock('openai', () => {
  class OpenAIMock {
    images = { generate: openaiImagesGenerate };

    constructor() {
      return this;
    }
  }

  return {
    __esModule: true,
    default: OpenAIMock,
  };
});

vi.mock('../../src/config/env', () => ({
  env: {
    OPENAI_API_KEY: 'test-openai-key',
    GEMINI_API_KEY: 'test-gemini-key',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    MISTRAL_API_KEY: 'test-mistral-key',
    COHERE_API_KEY: 'test-cohere-key',
  },
}));

vi.mock('../../src/services/settings', () => ({
  settingsService: {
    getAISettings: vi.fn().mockResolvedValue({
      defaultProviderId: 'openai',
      defaultModel: 'gpt-4.1-nano',
      concurrency: 1,
      publishingConcurrency: 1,
      processingInterval: 1000,
    }),
    get: vi.fn().mockResolvedValue(null),
  },
}));

const credentialsByProvider: Record<string, string> = {
  openai: 'test-openai-key',
  gemini: 'test-gemini-key',
  anthropic: 'test-anthropic-key',
  mistral: 'test-mistral-key',
  cohere: 'test-cohere-key',
};

vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn(async ({ providerId }: { providerId: keyof typeof credentialsByProvider }) => ({
    providerId,
    credential: credentialsByProvider[providerId] ?? 'test-key',
    source: 'environment',
  })),
}));

import { generateImage } from '../../src/services/llm-runtime';

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('image generation runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('routes OpenAI image generation and normalizes base64 images', async () => {
    openaiImagesGenerate.mockResolvedValue({
      data: [
        {
          b64_json: 'U0FNUExFQl9CQVNFMjU2X0RBVEE=',
          revised_prompt: 'Logo',
        },
      ],
    });

    const result = await generateImage({
      providerId: 'openai',
      model: 'gpt-image-2',
      prompt: 'Logo',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });

    expect(openaiImagesGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-2', prompt: 'Logo' }),
      expect.anything(),
    );
    expect(result.images[0]).toEqual(
      expect.objectContaining({ mimeType: 'image/png', data: expect.any(String) }),
    );
  });

  it('defaults OpenAI image generation to the provider image model when model is omitted', async () => {
    openaiImagesGenerate.mockResolvedValue({
      data: [
        {
          b64_json: 'U0FNUExFQl9CQVNFMjU2X0RBVEE=',
        },
      ],
    });

    await generateImage({
      providerId: 'openai',
      prompt: 'Logo',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });

    expect(openaiImagesGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-2', prompt: 'Logo' }),
      expect.anything(),
    );
  });

  it('routes Gemini image generation and normalizes inlineData images', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [{
                inlineData: {
                  mimeType: 'image/png',
                  data: 'R0lGODlhZQ==',
                },
              }],
            },
          },
        ],
      }),
    );

    const result = await generateImage({
      providerId: 'gemini',
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'Logo',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchInit] = fetchMock.mock.calls[0] ?? [];
    expect(fetchUrl as string).toContain(':generateContent?key=test-gemini-key');
    const fetchBody = JSON.parse((fetchInit as RequestInit).body as string) as {
      contents: Array<Record<string, unknown>>;
      generationConfig: { responseModalities: string[] };
    };
    expect(fetchBody.contents).toEqual(
      expect.arrayContaining([
        {
          role: 'user',
          parts: expect.arrayContaining([{ text: 'Logo' }]),
        },
      ]),
    );
    expect(fetchBody.generationConfig.responseModalities).toContain('IMAGE');

    expect(result.images[0]).toEqual(
      expect.objectContaining({ mimeType: 'image/png', data: 'R0lGODlhZQ==' }),
    );
  });

  it('maps OpenAI policy refusals to deterministic image errors', async () => {
    openaiImagesGenerate.mockResolvedValue({
      data: [],
      error: {
        code: 'content_policy_violation',
        message: 'The prompt was rejected by the image safety policy',
      },
    });

    await expect(
      generateImage({
        providerId: 'openai',
        model: 'gpt-image-2',
        prompt: 'Disallowed prompt',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: 'provider_refusal',
      message: 'The prompt was rejected by the image safety policy',
    });
  });

  it('maps Gemini safety blocks to deterministic image errors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        promptFeedback: {
          blockReason: 'SAFETY',
        },
        candidates: [
          {
            finishReason: 'SAFETY',
            content: { parts: [] },
          },
        ],
      }),
    );

    await expect(
      generateImage({
        providerId: 'gemini',
        model: 'gemini-3.1-flash-image-preview',
        prompt: 'Disallowed prompt',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: 'provider_refusal',
      message: 'Gemini image generation was blocked: SAFETY',
    });
  });

  it('fails when image path is unsupported for provider capability matrix', async () => {
    await expect(
      generateImage({
        providerId: 'anthropic',
        model: 'claude-opus-4-7',
        prompt: 'Logo',
      }),
    ).rejects.toThrow('Image generation is unsupported');
  });
});
