import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { httpRequest, authenticatedHttpRequest } from '../utils/test-helpers';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('API Health', () => {
  it('keeps health anonymous while gating connector and agent administration paths', async () => {
    const response = await httpRequest('/api/v1/health');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');

    const disabledCli = await httpRequest('/api/v1/cli/intents', { method: 'POST' });
    expect(disabledCli.status).toBe(404);
    for (const path of ['/command', '/commands', '/terminal', '/shell']) {
      const legacyCli = await httpRequest(`/api/v1${path}`, { method: 'POST' });
      expect(legacyCli.status, path).toBe(404);
    }

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
      ['GET', '/api/v1/streams/active'],
      ['GET', '/api/v1/streams/sse'],
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

    it('emits the live business cutover probe status map', async () => {
      const [health, canonical, duplicate, anonymousDocx, authenticatedDocx] = await Promise.all([
        httpRequest('/api/v1/health'),
        httpRequest('/api/v1/organizations'),
        httpRequest('/api/v1/business/organizations'),
        httpRequest('/api/v1/use-cases/historical-id/docx'),
        authenticatedHttpRequest(
          'GET', '/api/v1/use-cases/historical-id/docx', user.sessionToken!,
        ),
      ]);
      const statuses = {
        health: health.status,
        canonicalBusinessAnonymous: canonical.status,
        duplicateBusiness: duplicate.status,
        docxAnonymous: anonymousDocx.status,
        docxAuthenticated: authenticatedDocx.status,
      };
      console.info(`D11_BUSINESS_PROBE ${JSON.stringify(statuses)}`);
      expect(statuses).toEqual({
        health: 200, canonicalBusinessAnonymous: 401, duplicateBusiness: 404,
        docxAnonymous: 401, docxAuthenticated: 410,
      });
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
