import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractUrlContent } from '../../src/services/tools';
import type { ExtractResult } from '../../src/services/tools';
import fetch from 'node-fetch';

// Mock node-fetch
vi.mock('node-fetch', () => {
  return {
    default: vi.fn()
  };
});

describe('Tools - extractUrlContent', () => {
  const mockFetch = vi.mocked(fetch);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('extractUrlContent with single URL', () => {
    it('should extract content from a single URL', async () => {
      const mockResponse = {
        results: [
          {
            url: 'https://example.com/test',
            title: 'Test Page',
            raw_content: 'This is the raw content from the page',
            markdown: '# Test Page\n\nThis is the raw content from the page'
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await extractUrlContent('https://example.com/test');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.tavily.com/extract',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': expect.stringContaining('Bearer')
          }),
          body: JSON.stringify({
            urls: ['https://example.com/test'],
            format: 'markdown',
            extract_depth: 'advanced'
          })
        })
      );

      expect(result).toBeDefined();
      if (!Array.isArray(result)) {
        expect(result.url).toBe('https://example.com/test');
        expect(result.content).toBe('This is the raw content from the page');
      }
    });

    it('should use raw_content when available', async () => {
      const mockResponse = {
        results: [
          {
            url: 'https://example.com/page',
            raw_content: 'Raw content only',
            // Pas de markdown ni content
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await extractUrlContent('https://example.com/page');

      if (!Array.isArray(result)) {
        expect(result.content).toBe('Raw content only');
      }
    });

    it('should fallback to markdown if raw_content not available', async () => {
      const mockResponse = {
        results: [
          {
            url: 'https://example.com/page',
            markdown: '# Markdown content',
            // Pas de raw_content
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await extractUrlContent('https://example.com/page');

      if (!Array.isArray(result)) {
        expect(result.content).toBe('# Markdown content');
      }
    });
  });

  describe('extractUrlContent with array of URLs', () => {
    it('should extract content from multiple URLs in a single call', async () => {
      const urls = [
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3'
      ];

      const mockResponse = {
        results: [
          {
            url: 'https://example.com/1',
            title: 'Page 1',
            raw_content: 'Content 1'
          },
          {
            url: 'https://example.com/2',
            title: 'Page 2',
            raw_content: 'Content 2'
          },
          {
            url: 'https://example.com/3',
            title: 'Page 3',
            raw_content: 'Content 3'
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await extractUrlContent(urls);

      // Un seul appel Tavily avec toutes les URLs
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.tavily.com/extract',
        expect.objectContaining({
          body: JSON.stringify({
            urls: urls,
            format: 'markdown',
            extract_depth: 'advanced'
          })
        })
      );

      // Résultat est un array
      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result.length).toBe(3);
        expect(result[0].url).toBe('https://example.com/1');
        expect(result[1].url).toBe('https://example.com/2');
        expect(result[2].url).toBe('https://example.com/3');
      }
    });

    it('should handle large array of URLs (e.g., 9 URLs)', async () => {
      const urls = Array.from({ length: 9 }, (_, i) => `https://example.com/${i + 1}`);

      const mockResponse = {
        results: urls.map((url, i) => ({
          url,
          title: `Page ${i + 1}`,
          raw_content: `Content ${i + 1}`
        }))
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await extractUrlContent(urls);

      // Un seul appel Tavily
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.urls).toHaveLength(9);

      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result.length).toBe(9);
      }
    });
  });

  describe('extractUrlContent error handling', () => {
    it('should handle HTTP error responses', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid request'
      } as Response;

      mockFetch.mockResolvedValueOnce(mockResponse);

      await expect(
        extractUrlContent('https://example.com/invalid')
      ).rejects.toThrow('Tavily extract failed: 400 Bad Request');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle empty content gracefully', async () => {
      const mockResponse = {
        results: [
          {
            url: 'https://example.com/empty',
            // Pas de raw_content, markdown, ni content
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await extractUrlContent('https://example.com/empty');

      if (!Array.isArray(result)) {
        // Devrait retourner une structure valide même avec contenu vide
        expect(result.url).toBe('https://example.com/empty');
        expect(result.content).toBe(''); // Contenu vide mais structure correcte
      }
    });

    it('should handle AbortSignal', async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        extractUrlContent('https://example.com/test', abortController.signal)
      ).rejects.toThrow('AbortError');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        extractUrlContent('https://example.com/test')
      ).rejects.toThrow();
    });
  });

  describe('extractUrlContent response parsing', () => {
    it('should parse Tavily response correctly', async () => {
      const mockResponse = {
        results: [
          {
            url: 'https://example.com/test',
            title: 'Test Title',
            raw_content: 'Raw content here',
            markdown: '# Markdown here',
            content: 'Plain content here'
          }
        ],
        failed_results: [],
        response_time: 1.5,
        request_id: 'test-request-id'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await extractUrlContent('https://example.com/test');

      // raw_content doit être utilisé en priorité
      if (!Array.isArray(result)) {
        expect(result.content).toBe('Raw content here'); // raw_content prioritaire
        expect(result.url).toBe('https://example.com/test');
      }
    });

    it('should handle missing fields gracefully', async () => {
      const mockResponse = {
        results: [
          {
            url: 'https://example.com/minimal'
            // Pas de title, raw_content, markdown, ni content
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await extractUrlContent('https://example.com/minimal');

      if (!Array.isArray(result)) {
        expect(result.url).toBe('https://example.com/minimal');
        expect(result.content).toBe(''); // Contenu vide
      }
    });
  });
});

