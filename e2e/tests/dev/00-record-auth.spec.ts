import { expect, request, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { deleteAllEmails, waitForMagicLinkToken } from '../../helpers/maildev';

const API_BASE_URL = process.env.API_BASE_URL || 'http://api:8787';
const UI_BASE_URL = process.env.UI_BASE_URL || 'http://ui:5173';
const STORAGE_STATE_PATH = '/app/.auth/dev-state.json';
const AUTH_EMAIL = process.env.DEV_PLAYWRIGHT_AUTH_EMAIL || 'admin@sent-tech.ca';

test.describe.serial('Dev Playwright auth recording', () => {
  test.use({ storageState: undefined });

  test(`records storageState for ${AUTH_EMAIL}`, async ({ browser }) => {
    await deleteAllEmails();

    const requestApi = await request.newContext({ baseURL: API_BASE_URL, storageState: undefined });
    try {
      const requestRes = await requestApi.post('/api/v1/auth/magic-link/request', {
        data: { email: AUTH_EMAIL },
      });
      expect(requestRes.ok(), `magic-link request should succeed for ${AUTH_EMAIL}`).toBe(true);
    } finally {
      await requestApi.dispose();
    }

    const token = await waitForMagicLinkToken(AUTH_EMAIL, 60_000);
    const verifyApi = await request.newContext({ baseURL: API_BASE_URL, storageState: undefined });
    let sessionToken: string | undefined;
    try {
      const verifyRes = await verifyApi.post('/api/v1/auth/magic-link/verify', {
        data: { token },
        headers: { origin: UI_BASE_URL },
      });
      expect(verifyRes.ok(), `magic-link verify should succeed for ${AUTH_EMAIL}`).toBe(true);
      const payload = (await verifyRes.json()) as { sessionToken?: string };
      sessionToken = payload.sessionToken;
    } finally {
      await verifyApi.dispose();
    }

    expect(sessionToken, 'magic-link verify should return a sessionToken').toBeTruthy();

    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await context.addCookies([
      {
        name: 'session',
        value: sessionToken!,
        url: UI_BASE_URL,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await page.goto(`${UI_BASE_URL}/folders`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page.locator('body')).toBeAttached();

    fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
    await context.storageState({ path: STORAGE_STATE_PATH });
    await context.close();

    expect(fs.existsSync(STORAGE_STATE_PATH)).toBe(true);
  });
});
