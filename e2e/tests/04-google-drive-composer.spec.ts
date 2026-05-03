import { test, expect, request, type Browser, type Page } from '@playwright/test';

import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Google Drive composer integration (mocked browser UX)', () => {
  test.describe.configure({ mode: 'serial' });

  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';

  async function createScopedPage(browser: Browser, workspaceId: string) {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });
    const page = await context.newPage();
    return { context, page };
  }

  async function openChat(page: Page) {
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();
    await expect(page.locator('#chat-widget-dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[role="textbox"][aria-label="Composer"]')).toBeVisible({
      timeout: 10_000,
    });
  }

  async function openComposerMenu(page: Page) {
    const menuButton = page
      .locator(
        '#chat-widget-dialog button[aria-label="Ouvrir le menu"]:visible, #chat-widget-dialog button[aria-label="Open menu"]:visible',
      )
      .first();
    await expect(menuButton).toBeVisible({ timeout: 10_000 });
    await menuButton.click();
  }

  const IMPORT_BUTTON_LABEL = /Import from Google Drive|Importer depuis Google Drive/i;
  const SETTINGS_BUTTON_LABEL =
    /Manage Google Drive in Settings|Gérer Google Drive dans Paramètres/i;

  async function installGooglePickerMock(page: Page, pickedFileIds: string[]) {
    await page.addInitScript((fileIds: string[]) => {
      const windowLike = window as typeof window & {
        gapi?: { load?: (name: string, options: unknown) => void };
        google?: { picker?: unknown };
      };

      const invokeLoadCallback = (options: unknown) => {
        if (typeof options === 'function') {
          options();
          return;
        }
        if (options && typeof options === 'object' && 'callback' in options) {
          const callback = (options as { callback?: () => void }).callback;
          callback?.();
        }
      };

      class MockDocsView {
        setMimeTypes(_mimeTypes: string) {}
        setIncludeFolders(_includeFolders: boolean) {}
        setSelectFolderEnabled(_enabled: boolean) {}
        setMode(_mode: string) {}
      }

      class MockPickerBuilder {
        private callback: ((data: { action: string; docs?: Array<{ id: string }> }) => void) | null = null;

        setDeveloperKey(_key: string) {
          return this;
        }

        setAppId(_appId: string) {
          return this;
        }

        setOAuthToken(_token: string) {
          return this;
        }

        setLocale(_locale: string) {
          return this;
        }

        setOrigin(_origin: string) {
          return this;
        }

        setRelayUrl(_relayUrl: string) {
          return this;
        }

        addView(_view: unknown) {
          return this;
        }

        enableFeature(_feature: string) {
          return this;
        }

        setCallback(callback: (data: { action: string; docs?: Array<{ id: string }> }) => void) {
          this.callback = callback;
          return this;
        }

        build() {
          return {
            setVisible: (visible: boolean) => {
              if (!visible || !this.callback) return;
              queueMicrotask(() => {
                this.callback?.({
                  action: 'picked',
                  docs: fileIds.map((id) => ({ id })),
                });
              });
            },
          };
        }
      }

      windowLike.gapi = {
        load: (_name: string, options: unknown) => invokeLoadCallback(options),
      };
      windowLike.google = {
        picker: {
          DocsView: MockDocsView,
          DocsViewMode: {
            LIST: 'LIST',
          },
          Feature: {
            MULTISELECT_ENABLED: 'MULTISELECT_ENABLED',
            SUPPORT_DRIVES: 'SUPPORT_DRIVES',
          },
          Action: {
            PICKED: 'picked',
            CANCEL: 'cancel',
          },
          ViewId: {
            DOCS: 'DOCS',
          },
          PickerBuilder: MockPickerBuilder,
        },
      };
    }, pickedFileIds);
  }

  test('imports Google Drive files through the composer with browser mocks', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const userApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const workspaceName = `Drive Composer Mock ${Date.now()}`;
    const workspaceRes = await userApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspaceJson = await workspaceRes.json().catch(() => null);
    const workspaceId = String(workspaceJson?.id ?? '');
    expect(workspaceId).toBeTruthy();

    const { context, page } = await createScopedPage(browser, workspaceId);

    const pickedFileId = `mock-drive-file-${Date.now()}`;
    const pickedFileName = `Google Drive facts ${Date.now()}.md`;
    let googleDriveConnected = true;
    let pickerConfigCount = 0;
    let lastResolvedFileIds: string[] = [];
    let lastAttachContextId: string | null = null;
    let lastAttachContextType: string | null = null;
    let attachedDocs: Array<Record<string, unknown>> = [];

    await installGooglePickerMock(page, [pickedFileId]);

    await page.route(/\/api\/v1\/google-drive\/connection(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          account: {
            id: googleDriveConnected ? 'google-account-1' : null,
            provider: 'google_drive',
            status: googleDriveConnected ? 'connected' : 'disconnected',
            connected: googleDriveConnected,
            accountEmail: googleDriveConnected ? 'mock-drive-user@example.com' : null,
            accountSubject: googleDriveConnected ? 'google-subject-1' : null,
            scopes: googleDriveConnected ? ['https://www.googleapis.com/auth/drive.file'] : [],
            tokenExpiresAt: null,
            connectedAt: googleDriveConnected ? '2026-04-27T10:00:00.000Z' : null,
            disconnectedAt: googleDriveConnected ? null : '2026-04-27T09:55:00.000Z',
            lastError: null,
            updatedAt: '2026-04-27T10:00:00.000Z',
          },
        }),
      });
    });

    await page.route(/\/api\/v1\/google-drive\/picker-config(?:\?.*)?$/, async (route) => {
      pickerConfigCount += 1;
      if (!googleDriveConnected) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Google Drive account is not connected' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          picker: {
            client_id: 'mock-client-id.apps.googleusercontent.com',
            developer_key: 'mock-developer-key',
            app_id: 'mock-app-id',
            oauth_token: 'mock-oauth-token',
            scope: 'https://www.googleapis.com/auth/drive.file',
          },
        }),
      });
    });

    await page.route(/\/api\/v1\/google-drive\/files\/resolve-picker-selection(?:\?.*)?$/, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}') as { file_ids?: string[] };
      lastResolvedFileIds = Array.isArray(body.file_ids) ? body.file_ids : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          files: [
            {
              id: pickedFileId,
              name: pickedFileName,
              mime_type: 'text/markdown',
              web_view_link: 'https://drive.google.com/file/d/mock/view',
              web_content_link: null,
              icon_link: null,
              modified_time: '2026-04-27T10:00:00.000Z',
              version: '17',
              size: '1024',
              md5_checksum: null,
              drive_id: null,
              supported: true,
              export_mime_type: null,
            },
          ],
        }),
      });
    });

    await page.route(/\/api\/v1\/documents\/google-drive(?:\?.*)?$/, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}') as {
        context_type?: string;
        context_id?: string;
        file_ids?: string[];
      };
      lastAttachContextType = body.context_type ?? null;
      lastAttachContextId = body.context_id ?? null;
      attachedDocs = [
        {
          id: 'mock-doc-1',
          context_type: 'chat_session',
          context_id: lastAttachContextId,
          filename: pickedFileName,
          mime_type: 'text/markdown',
          size_bytes: 1024,
          status: 'ready',
          summary: 'Mocked Google Drive summary',
          summary_lang: 'en',
          source_type: 'google_drive',
          job_id: 'job-google-drive-1',
        },
      ];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'mock-doc-1',
              source_type: 'google_drive',
              context_type: body.context_type,
              context_id: body.context_id,
              filename: pickedFileName,
              mime_type: 'text/markdown',
              size_bytes: 1024,
              storage_key: null,
              status: 'uploaded',
              job_id: 'job-google-drive-1',
            },
          ],
        }),
      });
    });

    await page.route(/\/api\/v1\/documents\?.*context_type=chat_session.*$/, async (route) => {
      const url = new URL(route.request().url());
      const contextId = url.searchParams.get('context_id');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: contextId && contextId === lastAttachContextId ? attachedDocs : [],
        }),
      });
    });

    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await openChat(page);
      await openComposerMenu(page);

      const importButton = page.getByRole('button', { name: IMPORT_BUTTON_LABEL });
      await expect(importButton).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#chat-widget-dialog')).toContainText('mock-drive-user@example.com');
      await expect(page.getByRole('button', { name: SETTINGS_BUTTON_LABEL })).toHaveCount(0);

      await importButton.click();

      await expect.poll(() => pickerConfigCount).toBe(1);
      await expect.poll(() => lastResolvedFileIds.join(',')).toBe(pickedFileId);
      await expect.poll(() => lastAttachContextType).toBe('chat_session');
      await expect.poll(() => (lastAttachContextId ? 'yes' : 'no')).toBe('yes');

      await expect(page.locator('#chat-widget-dialog')).toContainText(pickedFileName, {
        timeout: 10_000,
      });
      await expect(page.locator('#chat-widget-dialog')).toContainText(/Summary ready|Résumé prêt/, {
        timeout: 10_000,
      });
    } finally {
      await context.close();
      await userApi.dispose();
    }
  });

  test('routes disconnected users to Settings from the composer menu', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const userApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const workspaceName = `Drive Composer Error ${Date.now()}`;
    const workspaceRes = await userApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspaceJson = await workspaceRes.json().catch(() => null);
    const workspaceId = String(workspaceJson?.id ?? '');
    expect(workspaceId).toBeTruthy();

    const { context, page } = await createScopedPage(browser, workspaceId);

    await page.route(/\/api\/v1\/google-drive\/connection(?:\?.*)?$/, async (route) => {
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
            disconnectedAt: null,
            lastError: null,
            updatedAt: '2026-04-27T10:15:00.000Z',
          },
        }),
      });
    });

    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await openChat(page);
      await openComposerMenu(page);

      await page.getByRole('button', { name: SETTINGS_BUTTON_LABEL }).click();

      await expect(page).toHaveURL(/\/settings$/);
    } finally {
      await context.close();
      await userApi.dispose();
    }
  });
});
