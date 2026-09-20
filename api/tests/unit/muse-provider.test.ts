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
    it('should list nothing until a dispatch path exists (Lot 2 transport)', () => {
      // Advertising unservable models would route traffic into a throw.
      expect(runtime.listModels()).toEqual([]);
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
    it('should reject dispatch until the Lot 2 account transport lands', async () => {
      await expect(
        runtime.generate({ mode: 'msp', requestOptions: {} }),
      ).rejects.toThrow('account transport');
    });
  });
});
