import { expect, test, type Page } from '@playwright/test';

const UI_BASE_URL = process.env.UI_BASE_URL || 'http://ui:5173';
const API_BASE_URL = process.env.API_BASE_URL || 'http://api:8787';

type JsonBody = Record<string, unknown> | null;

type GoogleDriveConnectionPayload = {
  account?: {
    connected?: boolean;
    accountEmail?: string | null;
  };
};

type ApiProbeResult = {
  status: number;
  body: JsonBody;
};

async function fetchJson(
  page: Page,
  apiPath: string,
  init?: { method?: 'GET' | 'POST'; data?: Record<string, unknown> },
): Promise<ApiProbeResult> {
  return page.evaluate(
    async ({ requestUrl, requestInit }) => {
      const method = requestInit?.method ?? 'GET';
      const response = await fetch(requestUrl, {
        method,
        credentials: 'include',
        headers: requestInit?.data ? { 'content-type': 'application/json' } : undefined,
        body: requestInit?.data ? JSON.stringify(requestInit.data) : undefined,
      });
      let body: JsonBody = null;
      try {
        body = (await response.json()) as JsonBody;
      } catch {
        body = null;
      }
      return {
        status: response.status,
        body,
      };
    },
    { requestUrl: `${API_BASE_URL}${apiPath}`, requestInit: init ?? null },
  );
}

async function hydrateWorkspaceScope(page: Page): Promise<string> {
  await page.goto(`${UI_BASE_URL}/folders`);
  await page.waitForLoadState('domcontentloaded');

  const probe = await fetchJson(page, '/api/v1/workspaces');
  expect(probe.status).toBe(200);
  const items = Array.isArray((probe.body as { items?: unknown[] } | null)?.items)
    ? (((probe.body as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>)
    : [];
  expect(items.length).toBeGreaterThan(0);

  const workspaceId = String(items[0]?.id ?? '').trim();
  expect(workspaceId).toBeTruthy();

  await page.evaluate((value) => localStorage.setItem('workspaceScopeId', value), workspaceId);
  await page.goto(`${UI_BASE_URL}/folders`);
  await page.waitForLoadState('domcontentloaded');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('workspaceScopeId')))
    .toBe(workspaceId);

  return workspaceId;
}

async function openComposerMenu(page: Page) {
  await page.getByRole('button', { name: 'Chat / Jobs' }).click();
  await expect(page.locator('#chat-widget-dialog')).toBeVisible({ timeout: 10_000 });
  await page
    .locator(
      '#chat-widget-dialog button[aria-label="Ouvrir le menu"]:visible, #chat-widget-dialog button[aria-label="Open menu"]:visible',
    )
    .first()
    .click();
}

test.describe.serial('Google Drive live readiness (dev lane)', () => {
  test('proves the real runtime branch for Google Drive connect/import readiness', async ({ page }) => {
    test.setTimeout(120_000);

    const workspaceId = await hydrateWorkspaceScope(page);
    await openComposerMenu(page);

    const connectionProbe = (await fetchJson(
      page,
      `/api/v1/google-drive/connection?workspace_id=${encodeURIComponent(workspaceId)}`,
    )) as ApiProbeResult;
    expect(connectionProbe.status).toBe(200);

    const connection = connectionProbe.body as GoogleDriveConnectionPayload | null;
    const isConnected = Boolean(connection?.account?.connected);

    if (isConnected) {
      await expect(
        page.getByRole('button', { name: /Import from Google Drive|Importer depuis Google Drive/i }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole('button', { name: /Disconnect Google Drive|Déconnecter Google Drive/i }),
      ).toBeVisible({ timeout: 10_000 });

      const pickerProbe = await fetchJson(
        page,
        `/api/v1/google-drive/picker-config?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      expect([200, 503]).toContain(pickerProbe.status);
      if (pickerProbe.status === 200) {
        const pickerBody = pickerProbe.body as {
          picker?: { client_id?: string; developer_key?: string; app_id?: string };
        } | null;
        expect(String(pickerBody?.picker?.client_id ?? '').trim()).toBeTruthy();
        expect(String(pickerBody?.picker?.developer_key ?? '').trim()).toBeTruthy();
        expect(String(pickerBody?.picker?.app_id ?? '').trim()).toBeTruthy();
      } else {
        expect((pickerProbe.body as { message?: string } | null)?.message).toBe(
          'Google Drive Picker is not configured.',
        );
      }
      return;
    }

    const oauthProbe = await fetchJson(
      page,
      `/api/v1/google-drive/oauth/start?workspace_id=${encodeURIComponent(workspaceId)}`,
      {
        method: 'POST',
        data: { returnPath: '/folders' },
      },
    );
    expect([200, 503]).toContain(oauthProbe.status);

    const currentUrl = page.url();
    await page.getByRole('button', { name: /Connect Google Drive|Connecter Google Drive/i }).click();

    if (oauthProbe.status === 503) {
      expect((oauthProbe.body as { message?: string } | null)?.message).toBe(
        'Google Drive OAuth is not configured.',
      );
      await expect(page.locator('#chat-widget-dialog')).toContainText(
        'Google Drive OAuth is not configured.',
        { timeout: 10_000 },
      );
      await expect(page).toHaveURL(currentUrl);
      return;
    }

    const oauthBody = oauthProbe.body as { authorizationUrl?: string } | null;
    expect(String(oauthBody?.authorizationUrl ?? '')).toContain('accounts.google.com');
    await expect.poll(() => page.url(), { timeout: 15_000 }).not.toBe(currentUrl);
  });
});
