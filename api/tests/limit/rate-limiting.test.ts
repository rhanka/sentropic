import { describe, it, expect } from 'vitest';
import { app } from '../../src/app';

describe('Rate Limiting Tests', () => {
  it('should enforce rate limiting on auth login options', async () => {
    // Make multiple rapid requests to trigger rate limiting
    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(
        app.request('/api/v1/auth/login/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userName: 'test@example.com' }),
        })
      );
    }

    const responses = await Promise.all(requests);
    
    // Should get some 429 responses due to rate limiting
    const rateLimitedResponses = responses.filter(res => res.status === 429);
    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });

  it('should enforce rate limiting on auth register options', async () => {
    // Make multiple rapid requests to trigger rate limiting
    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push(
        app.request('/api/v1/auth/register/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: 'testuser',
            userDisplayName: 'Test User',
            email: `test${i}@example.com`,
          }),
        })
      );
    }

    const responses = await Promise.all(requests);
    
    // Should get some 429 responses due to rate limiting (3 per hour limit)
    const rateLimitedResponses = responses.filter(res => res.status === 429);
    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });

  it('should enforce rate limiting on magic link requests', async () => {
    // Make multiple rapid requests to trigger rate limiting
    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push(
        app.request('/api/v1/auth/magic-link/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: `test${i}@example.com` }),
        })
      );
    }

    const responses = await Promise.all(requests);
    
    // Should get some 429 responses due to rate limiting (3 per 15 minutes)
    const rateLimitedResponses = responses.filter(res => res.status === 429);
    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });
});
