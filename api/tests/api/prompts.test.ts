import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { LEGACY_PROMPT_CATALOG } from '../../src/config/default-chat-system';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('Prompts API', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /prompts', () => {
    it('should get all prompts', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/prompts', user.sessionToken!);
      
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ prompts: LEGACY_PROMPT_CATALOG });
    });
  });

  it('preserves the validated update refusal wire', async () => {
    const response = await authenticatedRequest(
      app, 'PUT', '/api/v1/prompts', user.sessionToken!, { prompts: [{}] },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      message: 'Erreur lors de la mise à jour des prompts',
    });
  });

  it('keeps the root-remapped prompt path authenticated', async () => {
    expect((await app.request('/api/v1/prompts')).status).toBe(401);
    expect((await app.request('/api/v1/agents/prompts')).status).toBe(404);
  });
});
