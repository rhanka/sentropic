import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetFetchMock, mockFetchJsonOnce } from '../../tests/test-setup';
import {
  resolveViewTemplate,
  clearViewTemplateCache,
} from '../../src/lib/stores/viewTemplateCache';

describe('viewTemplateCache', () => {
  beforeEach(() => {
    resetFetchMock();
    clearViewTemplateCache();
  });

  it('should fetch and cache a resolved template', async () => {
    const mockDescriptor = {
      tabs: [{ key: 'detail', label: 'Detail', always: true, rows: [] }],
    };
    mockFetchJsonOnce({ descriptor: mockDescriptor });

    const result = await resolveViewTemplate('ws-1', 'ai-ideas', 'initiative');

    expect(result).toEqual(mockDescriptor);
  });

  it('should return cached value on second call (no additional fetch)', async () => {
    const mockDescriptor = {
      tabs: [{ key: 'detail', label: 'Detail', always: true, rows: [] }],
    };
    mockFetchJsonOnce({ descriptor: mockDescriptor });

    const result1 = await resolveViewTemplate('ws-1', 'ai-ideas', 'initiative');
    // Second call should not trigger another fetch (mock would reject)
    const result2 = await resolveViewTemplate('ws-1', 'ai-ideas', 'initiative');

    expect(result1).toEqual(mockDescriptor);
    expect(result2).toEqual(mockDescriptor);
    // fetch was called only once (for the first resolve)
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate concurrent requests for the same key', async () => {
    const mockDescriptor = {
      tabs: [{ key: 'detail', label: 'Detail', always: true, rows: [] }],
    };
    mockFetchJsonOnce({ descriptor: mockDescriptor });

    // Fire two concurrent resolves for the same key
    const [result1, result2] = await Promise.all([
      resolveViewTemplate('ws-1', 'ai-ideas', 'initiative'),
      resolveViewTemplate('ws-1', 'ai-ideas', 'initiative'),
    ]);

    expect(result1).toEqual(mockDescriptor);
    expect(result2).toEqual(mockDescriptor);
    // Only one fetch call should have been made (dedup)
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should use different cache entries for different keys', async () => {
    const descriptor1 = { tabs: [{ key: 'initiative', label: 'Initiative', rows: [] }] };
    const descriptor2 = { tabs: [{ key: 'organization', label: 'Organization', rows: [] }] };

    mockFetchJsonOnce({ descriptor: descriptor1 });
    mockFetchJsonOnce({ descriptor: descriptor2 });

    const result1 = await resolveViewTemplate('ws-1', 'ai-ideas', 'initiative');
    const result2 = await resolveViewTemplate('ws-1', 'ai-ideas', 'organization');

    expect(result1).toEqual(descriptor1);
    expect(result2).toEqual(descriptor2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should clear cache and allow re-fetching', async () => {
    const descriptor1 = { tabs: [{ key: 'v1', label: 'V1', rows: [] }] };
    const descriptor2 = { tabs: [{ key: 'v2', label: 'V2', rows: [] }] };

    mockFetchJsonOnce({ descriptor: descriptor1 });
    const result1 = await resolveViewTemplate('ws-1', 'ai-ideas', 'initiative');
    expect(result1).toEqual(descriptor1);

    clearViewTemplateCache();

    mockFetchJsonOnce({ descriptor: descriptor2 });
    const result2 = await resolveViewTemplate('ws-1', 'ai-ideas', 'initiative');
    expect(result2).toEqual(descriptor2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should return null when API returns no descriptor', async () => {
    mockFetchJsonOnce({});

    const result = await resolveViewTemplate('ws-1', 'ai-ideas', 'initiative');

    expect(result).toBeNull();
  });

  it('should return null and not cache on fetch error', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error'),
    );

    const result = await resolveViewTemplate('ws-1', 'ai-ideas', 'initiative');
    expect(result).toBeNull();

    // After error, next call should re-fetch (not cached)
    const descriptor = { tabs: [{ key: 'retry', label: 'Retry', rows: [] }] };
    mockFetchJsonOnce({ descriptor });
    const result2 = await resolveViewTemplate('ws-1', 'ai-ideas', 'initiative');
    expect(result2).toEqual(descriptor);
  });
});
