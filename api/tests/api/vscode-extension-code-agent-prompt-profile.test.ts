import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { app } from '../../src/app';
import { LEGACY_PROMPT_CATALOG } from '../../src/config/default-chat-system';
import { db } from '../../src/db/client';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  unauthenticatedRequest,
} from '../utils/auth-helper';

const PROMPTS_SETTINGS_KEY = 'prompts';

describe('VSCode extension code-agent prompt profile API', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('guest');
    await db.run(
      sql`DELETE FROM settings WHERE key = ${PROMPTS_SETTINGS_KEY} AND user_id IS NULL`,
    );
  });

  afterEach(async () => {
    await db.run(
      sql`DELETE FROM settings WHERE key = ${PROMPTS_SETTINGS_KEY} AND user_id IS NULL`,
    );
    await cleanupAuthData();
  });

  it('returns the instance-managed default code-agent prompt for authenticated users', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/vscode-extension/code-agent-prompt-profile',
      user.sessionToken!,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    const expectedPrompt =
      LEGACY_PROMPT_CATALOG.find((prompt) => prompt.id === 'chat_code_agent')?.content?.trim() || '';

    expect(payload).toEqual({
      promptId: 'chat_code_agent',
      defaultPrompt: expectedPrompt,
      source: 'default',
    });
  });

  it('returns the instance-managed settings prompt when configured globally', async () => {
    await db.run(sql`
      INSERT INTO settings (key, user_id, value, description, updated_at)
      VALUES (
        ${PROMPTS_SETTINGS_KEY},
        NULL,
        ${JSON.stringify({
          chat_code_agent: {
            content: 'INSTANCE_MANAGED_PROMPT_FROM_SETTINGS',
          },
        })},
        'VSCode prompt profile test',
        ${new Date().toISOString()}
      )
    `);

    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/vscode-extension/code-agent-prompt-profile',
      user.sessionToken!,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      promptId: 'chat_code_agent',
      defaultPrompt: 'INSTANCE_MANAGED_PROMPT_FROM_SETTINGS',
      source: 'settings',
    });
  });

  it('requires authentication', async () => {
    const response = await unauthenticatedRequest(
      app,
      'GET',
      '/api/v1/vscode-extension/code-agent-prompt-profile',
    );

    expect(response.status).toBe(401);
  });
});
