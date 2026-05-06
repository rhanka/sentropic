import { test, expect, request, type Browser, type Page } from '@playwright/test';

import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Google Drive settings and entity document surfaces', () => {
  test.describe.configure({ mode: 'serial' });

  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const CONNECT_BUTTON_LABEL = /Connect Google Drive|Connecter Google Drive/i;
  const DISCONNECT_BUTTON_LABEL = /Disconnect Google Drive|Déconnecter Google Drive/i;
  const SETTINGS_BUTTON_LABEL =
    /Connect Google Drive in Settings|Connecter Google Drive dans Paramètres/i;
  const IMPORT_BUTTON_LABEL = /Import from Google Drive|Importer depuis Google Drive/i;

  async function createScopedPage(browser: Browser, workspaceId: string) {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });
    const page = await context.newPage();
    return { context, page };
  }

  async function createWorkspace(userApi: Awaited<ReturnType<typeof request.newContext>>, name: string) {
    const workspaceRes = await userApi.post('/api/v1/workspaces', { data: { name } });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspaceJson = await workspaceRes.json().catch(() => null);
    const workspaceId = String(workspaceJson?.id ?? '');
    expect(workspaceId).toBeTruthy();
    return workspaceId;
  }

  async function createFolder(
    userApi: Awaited<ReturnType<typeof request.newContext>>,
    workspaceId: string,
    name: string,
  ) {
    const folderRes = await userApi.post(
      `/api/v1/folders?workspace_id=${encodeURIComponent(workspaceId)}`,
      {
        data: { name, description: 'Google Drive document source menu coverage' },
      },
    );
    expect(folderRes.ok()).toBeTruthy();
    const folderJson = await folderRes.json().catch(() => null);
    const folderId = String(folderJson?.id ?? '');
    expect(folderId).toBeTruthy();
    return folderId;
  }

  async function installGoogleDriveConnectionRoute(page: Page, state: {
    connected: boolean;
    accountEmail?: string | null;
  }) {
    await page.route(/\/api\/v1\/google-drive\/connection(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          account: {
            id: state.connected ? 'google-account-1' : null,
            provider: 'google_drive',
            status: state.connected ? 'connected' : 'disconnected',
            connected: state.connected,
            accountEmail: state.connected ? state.accountEmail ?? 'mock-drive-user@example.com' : null,
            accountSubject: state.connected ? 'google-subject-1' : null,
            scopes: state.connected ? ['https://www.googleapis.com/auth/drive.file'] : [],
            tokenExpiresAt: null,
            connectedAt: state.connected ? '2026-04-27T10:00:00.000Z' : null,
            disconnectedAt: state.connected ? null : '2026-04-27T09:55:00.000Z',
            lastError: null,
            updatedAt: '2026-04-27T10:00:00.000Z',
          },
        }),
      });
    });
  }

  test('manages Google Drive lifecycle from Settings', async ({ browser }) => {
    test.setTimeout(180_000);

    const userApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const workspaceId = await createWorkspace(userApi, `Drive Settings ${Date.now()}`);
    const { context, page } = await createScopedPage(browser, workspaceId);

    const googleDriveState = { connected: false, accountEmail: 'mock-drive-user@example.com' };
    let oauthStartCount = 0;
    let disconnectCount = 0;

    await installGoogleDriveConnectionRoute(page, googleDriveState);

    await page.route(/\/api\/v1\/google-drive\/oauth\/start(?:\?.*)?$/, async (route) => {
      oauthStartCount += 1;
      googleDriveState.connected = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authorizationUrl: '/settings?google_drive=connected#google-drive-connectors',
        }),
      });
    });

    await page.route(/\/api\/v1\/google-drive\/disconnect(?:\?.*)?$/, async (route) => {
      disconnectCount += 1;
      googleDriveState.connected = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          account: {
            id: null,
            provider: 'google_drive',
            status: 'disconnected',
            connected: false,
            accountEmail: null,
            accountSubject: null,
            scopes: [],
            tokenExpiresAt: null,
            connectedAt: null,
            disconnectedAt: '2026-04-27T10:10:00.000Z',
            lastError: null,
            updatedAt: '2026-04-27T10:10:00.000Z',
          },
        }),
      });
    });

    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByTestId('google-drive-connectors-card')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: CONNECT_BUTTON_LABEL })).toBeVisible({
        timeout: 10_000,
      });

      await page.getByRole('button', { name: CONNECT_BUTTON_LABEL }).click();
      await expect.poll(() => oauthStartCount).toBe(1);
      await expect(page).toHaveURL(
        /\/settings\?google_drive=connected#google-drive-connectors$/,
      );
      await expect(page.getByText(/Connected as mock-drive-user@example.com|Connecté avec mock-drive-user@example.com/i)).toBeVisible({
        timeout: 10_000,
      });

      await page.getByRole('button', { name: DISCONNECT_BUTTON_LABEL }).click();
      await expect.poll(() => disconnectCount).toBe(1);
      await expect(page.getByRole('button', { name: CONNECT_BUTTON_LABEL })).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await context.close();
      await userApi.dispose();
    }
  });

  test('shows the shared Google Drive source menu on DocumentsBlock surfaces', async ({ browser }) => {
    test.setTimeout(180_000);

    const userApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const workspaceId = await createWorkspace(userApi, `Drive Documents ${Date.now()}`);
    const folderId = await createFolder(userApi, workspaceId, `Drive Folder ${Date.now()}`);
    const { context, page } = await createScopedPage(browser, workspaceId);

    const googleDriveState = { connected: false, accountEmail: 'mock-drive-user@example.com' };

    await installGoogleDriveConnectionRoute(page, googleDriveState);

    await page.route(/\/api\/v1\/documents\?.*context_type=folder.*$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
    });

    try {
      await page.goto(`/folders/${folderId}`);
      await page.waitForLoadState('domcontentloaded');

      const addDocumentButton = page.getByRole('button', { name: /Add document|Ajouter un document/i }).first();
      await expect(addDocumentButton).toBeVisible({ timeout: 10_000 });
      await addDocumentButton.click();
      await expect(page.getByRole('button', { name: SETTINGS_BUTTON_LABEL })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/Connect Google Drive in Settings|Connecter Google Drive dans Paramètres/i)).toBeVisible();

      await page.getByRole('button', { name: SETTINGS_BUTTON_LABEL }).click();
      await expect(page).toHaveURL(/\/settings#google-drive-connectors$/);
      await expect(page.getByTestId('google-drive-connectors-card')).toBeVisible({
        timeout: 10_000,
      });

      googleDriveState.connected = true;
      await page.goto(`/folders/${folderId}`);
      await page.waitForLoadState('domcontentloaded');
      await addDocumentButton.click();

      await expect(page.getByRole('button', { name: IMPORT_BUTTON_LABEL })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/Connected as mock-drive-user@example.com|Connecté avec mock-drive-user@example.com/i)).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await context.close();
      await userApi.dispose();
    }
  });
});
