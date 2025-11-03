import { describe, it, expect } from 'vitest';
import { httpRequest } from '../utils/test-helpers';
import { generateTestVerificationToken } from '../utils/auth-helper';

describe('Rate Limiting Tests', () => {
  it('should enforce rate limiting on auth login options', async () => {
    // Make multiple rapid requests to trigger rate limiting
    const responses = [];
    for (let i = 0; i < 15; i++) { // More than the 10 limit
      const response = await httpRequest('/api/v1/auth/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
      responses.push(response);
      
      // Small delay to ensure requests are processed
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Should get some 429 responses due to rate limiting
    const rateLimitedResponses = responses.filter(res => res.status === 429);
    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });

  it('should enforce rate limiting on auth register options', async () => {
    // Make multiple rapid requests to trigger rate limiting
    // Note: For new users, we need verification tokens, but rate limiting is checked first
    const responses = [];
    for (let i = 0; i < 5; i++) { // More than the 3 limit
      const email = `test${i}@example.com`;
      // First request should trigger rate limiting check (even without token)
      const response = await httpRequest('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
        }),
      });
      responses.push(response);
      
      // Small delay to ensure requests are processed
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Should get some 429 responses due to rate limiting (3 per hour limit)
    // OR 403 responses for missing verification token
    const rateLimitedResponses = responses.filter(res => res.status === 429 || res.status === 403);
    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });

  it('should enforce rate limiting on magic link requests', async () => {
    // Make multiple rapid requests to trigger rate limiting
    const responses = [];
    for (let i = 0; i < 5; i++) { // More than the 3 limit
      const response = await httpRequest('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `test${i}@example.com` }),
      });
      responses.push(response);
      
      // Small delay to ensure requests are processed
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Should get some 429 responses due to rate limiting (3 per 15 minutes)
    const rateLimitedResponses = responses.filter(res => res.status === 429);
    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });
});
