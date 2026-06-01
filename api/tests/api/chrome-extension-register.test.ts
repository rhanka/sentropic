import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/app';
import { getTab, clearAll as clearTabRegistry } from '../../src/services/tab-registry';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

/**
 * Presence-registry register endpoint: source acceptance for browser and
 * non-browser (desktop_cowork) devices.
 */
describe('Presence registry — POST /chrome-extension/tabs/register', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    clearTabRegistry();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    clearTabRegistry();
    await cleanupAuthData();
  });

  it('accepts a chrome_plugin source', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chrome-extension/tabs/register',
      user.sessionToken!,
      { tab_id: 'chrome-1', source: 'chrome_plugin', url: 'https://example.com', title: 'X' },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, tab_id: 'chrome-1' });
  });

  it('accepts a desktop_cowork source and auto-assigns a device_ id', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chrome-extension/tabs/register',
      user.sessionToken!,
      { source: 'desktop_cowork', url: '', title: 'Workstation' },
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; tab_id: string };
    expect(payload.ok).toBe(true);
    expect(payload.tab_id).toMatch(/^device_/);

    const entry = getTab(payload.tab_id);
    expect(entry?.source).toBe('desktop_cowork');
    expect(entry?.userId).toBe(user.id);
  });

  it('rejects an unknown source with 400', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chrome-extension/tabs/register',
      user.sessionToken!,
      { source: 'totally_invalid', url: '', title: '' },
    );
    expect(response.status).toBe(400);
  });
});
