import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { httpRequest, authenticatedHttpRequest } from '../utils/test-helpers';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('API Health', () => {
  it('keeps health anonymous while gating connector and agent administration paths', async () => {
    const response = await httpRequest('/api/v1/health');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');

    const connectorPaths: ReadonlyArray<readonly [method: string, path: string]> = [
      ['GET', '/api/v1/google-drive/connection'],
      ['GET', '/api/v1/google-drive/picker-config'],
      ['POST', '/api/v1/google-drive/files/resolve-picker-selection'],
      ['POST', '/api/v1/google-drive/oauth/start'],
      ['GET', '/api/v1/google-drive/oauth/callback'],
      ['POST', '/api/v1/google-drive/disconnect'],
      ['GET', '/api/v1/gmail/connection'],
      ['POST', '/api/v1/gmail/oauth/start'],
      ['GET', '/api/v1/gmail/oauth/callback'],
      ['POST', '/api/v1/gmail/disconnect'],
      ['PUT', '/api/v1/settings/connector-accounts/max-per-provider'],
      ['GET', '/api/v1/agent-config'],
      ['GET', '/api/v1/prompts'],
    ];
    for (const [method, path] of connectorPaths) {
      const gatedResponse = await httpRequest(path, { method });
      expect(gatedResponse.status, `${method} ${path}`).toBe(401);
    }
  });

  describe('Authenticated endpoints', () => {
    let user: any;

    beforeEach(async () => {
      user = await createAuthenticatedUser('editor');
    });

    afterEach(async () => {
      await cleanupAuthData();
    });

    it('should have organizations endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/organizations', user.sessionToken!);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('should have folders endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/folders', user.sessionToken!);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('should have initiatives endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/initiatives', user.sessionToken!);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });
  });
});
