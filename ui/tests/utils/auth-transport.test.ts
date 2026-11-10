import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '../../src/lib/config';
import { createSentropicAuthTransport } from '../../src/lib/services/auth-transport';
import { mockFetchJsonOnce, resetFetchMock } from '../test-setup';

describe('Sentropic auth transport error surfacing', () => {
  beforeEach(() => {
    resetFetchMock();
    localStorage.clear();
  });

  it('hands a 4xx response to the transport: the closed code reaches the message, not « Network request failed »', async () => {
    mockFetchJsonOnce(
      { error: { code: 'authentication_verification_failed', message: 'Authentication verification failed.' } },
      401,
    );

    const result = await createSentropicAuthTransport().verifyEmailCode({ email: 'u@example.com', code: '000000' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('authentication_verification_failed');
      expect(result.error.message).not.toBe('Network request failed');
    }
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/auth/email/verify-code`);
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-App-Locale']).toBe('fr');
  });

  it('keeps a thrown fetch (offline) as the retryable network error', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await createSentropicAuthTransport().verifyEmailCode({ email: 'u@example.com', code: '000000' });

    expect(result.ok ? null : result.error.retryable).toBe(true);
  });
});
