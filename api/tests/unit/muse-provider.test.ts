import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable env mock to control key presence per case (hoisted: factory runs first)
const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));

vi.mock('../../src/config/env', () => ({
  env: mockEnv,
}));

import { MuseProviderRuntime } from '../../src/services/providers/muse-provider';

describe('MuseProviderRuntime', () => {
  let runtime: MuseProviderRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    delete mockEnv.MUSE_API_KEY;
    delete mockEnv.MODEL_API_KEY;
    runtime = new MuseProviderRuntime();
  });

  describe('provider descriptor', () => {
    it('should have correct provider id and label', () => {
      mockEnv.MUSE_API_KEY = 'test-muse-key';
      const keyed = new MuseProviderRuntime();
      expect(keyed.provider.providerId).toBe('muse');
      expect(keyed.provider.label).toBe('Meta Muse');
    });

    it('should report ready status when MUSE_API_KEY is configured', () => {
      mockEnv.MUSE_API_KEY = 'test-muse-key';
      const keyed = new MuseProviderRuntime();
      expect(keyed.provider.status).toBe('ready');
    });

    it('should report ready status via MODEL_API_KEY fallback', () => {
      mockEnv.MODEL_API_KEY = 'test-model-key';
      const keyed = new MuseProviderRuntime();
      expect(keyed.provider.status).toBe('ready');
    });
  });

  describe('listModels', () => {
    it('should advertise the muse models once dispatch exists', () => {
      const ids = runtime.listModels().map((m) => m.id ?? m.modelId);
      expect(ids).toContain('muse-spark-1.3');
    });
  });

  describe('validateCredential', () => {
    it('should prefer MUSE_API_KEY over MODEL_API_KEY', () => {
      mockEnv.MUSE_API_KEY = 'muse-key';
      mockEnv.MODEL_API_KEY = 'model-key';
      expect(runtime.validateCredential().ok).toBe(true);
    });

    it('should fall back to MODEL_API_KEY when MUSE_API_KEY is unset', () => {
      mockEnv.MODEL_API_KEY = 'model-key';
      expect(runtime.validateCredential().ok).toBe(true);
    });

    it('should return ok when override credential is provided', () => {
      expect(runtime.validateCredential('override-key').ok).toBe(true);
    });

    it('should return not ok when no key is configured', () => {
      const result = runtime.validateCredential('  ');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Muse API key');
    });
  });

  describe('normalizeError', () => {
    it('should normalize error with message string', () => {
      const normalized = runtime.normalizeError({ message: 'Rate limit exceeded', status: 429 });
      expect(normalized.providerId).toBe('muse');
      expect(normalized.message).toBe('Rate limit exceeded');
      expect(normalized.retryable).toBe(true);
    });

    it('should provide fallback message for unknown errors', () => {
      expect(runtime.normalizeError(null).message).toBe('Muse request failed');
    });
  });

  describe('generate', () => {
    it('should reject unsupported modes', async () => {
      await expect(
        runtime.generate({ mode: 'generate-content', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should throw when no key is configured', async () => {
      await expect(
        runtime.generate({ mode: 'msp', requestOptions: { body: {} } }),
      ).rejects.toThrow('Muse API key');
    });

    it('should POST the measured serving path with Bearer auth', async () => {
      mockEnv.MUSE_API_KEY = 'test-muse-key';
      const json = vi.fn(async () => ({ ok: true }));
      const fetchMock = vi.fn(async () => ({ ok: true, json }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        const out = await runtime.generate({
          mode: 'msp',
          requestOptions: { body: { hello: 'world' } },
        });
        expect(out).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.meta.ai/v1/chat/completions');
        expect(init.method).toBe('POST');
        const headers = init.headers as Record<string, string>;
        expect(headers.authorization).toBe('Bearer test-muse-key');
        expect(JSON.parse(init.body as string)).toEqual({ hello: 'world' });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should use the account-transport token when provided', async () => {
      const json = vi.fn(async () => ({ ok: true }));
      const fetchMock = vi.fn(async () => ({ ok: true, json }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await runtime.generate({
          mode: 'msp',
          requestOptions: { body: {} },
          museAccountTransport: { accessToken: 'transport-token', accountId: 'acct_1' },
        });
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = init.headers as Record<string, string>;
        expect(headers.authorization).toBe('Bearer transport-token');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should throw a provider error on non-2xx without leaking the key', async () => {
      mockEnv.MUSE_API_KEY = 'super-secret-key';
      const text = vi.fn(async () => 'billing_error');
      const fetchMock = vi.fn(async () => ({ ok: false, status: 402, text }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        const err = await runtime.generate({
          mode: 'msp',
          requestOptions: { body: {} },
        }).catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).not.toContain('super-secret-key');
        expect(err.message).toContain('402');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('streamGenerate', () => {
    it('should reject unsupported modes', async () => {
      await expect(
        runtime.streamGenerate({ mode: 'stream', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should throw when no key is configured', async () => {
      await expect(
        runtime.streamGenerate({ mode: 'msp', requestOptions: { body: {} } }) as Promise<unknown>,
      ).rejects.toThrow('Muse API key');
    });
  });
});
