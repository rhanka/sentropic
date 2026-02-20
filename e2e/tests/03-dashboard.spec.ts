import { test, expect, request, type Page } from '@playwright/test';
import {
  withWorkspaceAndFolderStorageState,
  withWorkspaceStorageState,
} from '../helpers/workspace-scope';

test.describe('Dashboard DOCX flow', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';

  const DOCX_PREPARE_LABEL = /Préparer le DOCX|Prepare DOCX/i;
  const DOCX_PREPARING_LABEL = /Préparation en cours|Preparation in progress/i;
  const DOCX_DOWNLOAD_LABEL = /Télécharger le DOCX|Download DOCX/i;
  const DOCX_STARTED_TOAST = /Préparation du document lancée\.|Document preparation started\./i;
  const DOCX_READY_TOAST = /Document prêt au téléchargement\.|Document ready for download\./i;

  let workspaceId = '';
  let organizationId = '';
  let folderId = '';
  let folderName = '';
  let summaryVersion = 0;

  const buildExecutiveSummary = (token: string) => ({
    synthese_executive: `Synthèse E2E ${token}`,
    introduction: `Introduction E2E ${token}`,
    analyse: `Analyse E2E ${token}`,
    recommandation: `Recommandation E2E ${token}`,
    references: [
      {
        title: `Reference ${token}`,
        url: `https://example.com/${token}`,
      },
    ],
  });

  const getActionsTrigger = (page: Page) =>
    page.getByRole('button', { name: /^Actions$/ }).first();

  const getDocxPrepareButton = (page: Page) => page.getByRole('button', { name: DOCX_PREPARE_LABEL }).first();
  const getDocxPreparingButton = (page: Page) => page.getByRole('button', { name: DOCX_PREPARING_LABEL }).first();
  const getDocxDownloadButton = (page: Page) => page.getByRole('button', { name: DOCX_DOWNLOAD_LABEL }).first();

  const hasAnyDocxMenuButtonVisible = async (page: Page): Promise<boolean> => {
    const hasPrepare = await getDocxPrepareButton(page).isVisible().catch(() => false);
    const hasPreparing = await getDocxPreparingButton(page).isVisible().catch(() => false);
    const hasDownload = await getDocxDownloadButton(page).isVisible().catch(() => false);
    return hasPrepare || hasPreparing || hasDownload;
  };

  const openActionsMenu = async (page: Page) => {
    if (await hasAnyDocxMenuButtonVisible(page)) return;
    await page.keyboard.press('Escape').catch(() => undefined);

    const trigger = getActionsTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 2_000 });
    await trigger.click();
    await expect
      .poll(async () => hasAnyDocxMenuButtonVisible(page), { timeout: 5_000, intervals: [200, 400, 600] })
      .toBe(true);
  };

  const getDocxMenuState = async (page: Page): Promise<'prepare' | 'preparing' | 'download' | 'unknown'> => {
    await openActionsMenu(page);
    const hasPrepare = await getDocxPrepareButton(page).isVisible().catch(() => false);
    const hasPreparing = await getDocxPreparingButton(page).isVisible().catch(() => false);
    const hasDownload = await getDocxDownloadButton(page).isVisible().catch(() => false);
    await page.keyboard.press('Escape');

    if (hasPreparing) return 'preparing';
    if (hasDownload) return 'download';
    if (hasPrepare) return 'prepare';
    return 'unknown';
  };

  const waitForDocxMenuState = async (
    page: Page,
    expected: 'prepare' | 'download',
    timeoutMs = 55_000
  ) => {
    await expect
      .poll(async () => getDocxMenuState(page), {
        timeout: timeoutMs,
        intervals: [500, 1000, 1500],
      })
      .toBe(expected);
  };

  const waitForDocxJobCompletion = async (page: Page, jobId: string, timeoutMs = 55_000) => {
    const readStatus = async (): Promise<string> => {
      const response = await page.request.get(
        `${API_BASE_URL}/api/v1/queue/jobs/${encodeURIComponent(jobId)}?workspace_id=${encodeURIComponent(workspaceId)}`
      );
      if (!response.ok()) return 'unknown';
      const payload = (await response.json().catch(() => null)) as { status?: string } | null;
      return payload?.status || 'unknown';
    };

    await expect
      .poll(readStatus, {
        timeout: timeoutMs,
        intervals: [500, 1000, 1500],
      })
      .toMatch(/completed|failed/i);

    const finalStatus = await readStatus();
    if (finalStatus !== 'completed' && finalStatus !== 'failed') {
      throw new Error(`Unexpected DOCX job status: ${finalStatus}`);
    }
    if (finalStatus === 'failed') {
      throw new Error(`DOCX job ${jobId} failed`);
    }
  };

  const prepareDocxIfNeeded = async (page: Page) => {
    const currentState = await getDocxMenuState(page);
    if (currentState === 'download') {
      return;
    }
    if (currentState === 'preparing') {
      await waitForDocxMenuState(page, 'download', 55_000);
      return;
    }

    await openActionsMenu(page);
    const prepareItem = getDocxPrepareButton(page);
    const [generateResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/v1/docx/generate') && res.request().method() === 'POST'),
      prepareItem.click(),
    ]);
    if (!generateResponse.ok()) {
      const errorBody = await generateResponse.text().catch(() => '');
      throw new Error(`DOCX generate request failed (${generateResponse.status()}): ${errorBody}`);
    }
    const payload = (await generateResponse.json().catch(() => null)) as
      | { jobId?: string; status?: string }
      | null;
    if (payload?.jobId && payload.status !== 'completed') {
      await waitForDocxJobCompletion(page, payload.jobId, 55_000);
    }
    await waitForDocxMenuState(page, 'download', 55_000);
  };

  const updateExecutiveSummary = async (page: Page, token: string) => {
    const response = await page.request.put(
      `${API_BASE_URL}/api/v1/folders/${folderId}?workspace_id=${encodeURIComponent(workspaceId)}`,
      {
        data: {
          executiveSummary: buildExecutiveSummary(token),
        },
      }
    );
    expect(response.ok()).toBeTruthy();
  };

  test.beforeAll(async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    const workspaceName = `Dashboard DOCX ${Date.now()}`;
    const createWorkspaceRes = await userAApi.post('/api/v1/workspaces', {
      data: { name: workspaceName },
    });
    if (!createWorkspaceRes.ok()) {
      throw new Error(`Cannot create workspace (status ${createWorkspaceRes.status()})`);
    }
    const createdWorkspace = await createWorkspaceRes.json().catch(() => null);
    workspaceId = String(createdWorkspace?.id || '');
    if (!workspaceId) throw new Error('workspaceId is missing');

    const addViewerRes = await userAApi.post(`/api/v1/workspaces/${workspaceId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'viewer' },
    });
    if (!addViewerRes.ok() && addViewerRes.status() !== 409) {
      throw new Error(`Cannot add viewer member (status ${addViewerRes.status()})`);
    }

    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${encodeURIComponent(workspaceId)}`, {
      data: {
        name: `Dashboard Org ${Date.now()}`,
        data: { industry: 'E2E' },
      },
    });
    if (!orgRes.ok()) {
      throw new Error(`Cannot create organization (status ${orgRes.status()})`);
    }
    const createdOrg = await orgRes.json().catch(() => null);
    organizationId = String(createdOrg?.id || '');
    if (!organizationId) throw new Error('organizationId is missing');

    folderName = `Dashboard Folder ${Date.now()}`;
    const folderRes = await userAApi.post(`/api/v1/folders?workspace_id=${encodeURIComponent(workspaceId)}`, {
      data: {
        name: folderName,
        description: 'E2E dashboard folder for DOCX flow',
        organizationId,
      },
    });
    if (!folderRes.ok()) {
      throw new Error(`Cannot create folder (status ${folderRes.status()})`);
    }
    const createdFolder = await folderRes.json().catch(() => null);
    folderId = String(createdFolder?.id || '');
    if (!folderId) throw new Error('folderId is missing');

    const useCaseNames = ['DOCX E2E Use Case A', 'DOCX E2E Use Case B'];

    for (const useCaseName of useCaseNames) {
      const useCaseRes = await userAApi.post(`/api/v1/use-cases?workspace_id=${encodeURIComponent(workspaceId)}`, {
        data: {
          folderId,
          organizationId,
          name: useCaseName,
          problem: `Problem for ${useCaseName}`,
          solution: `Solution for ${useCaseName}`,
        },
      });
      if (!useCaseRes.ok()) {
        throw new Error(`Cannot create use case \"${useCaseName}\" (status ${useCaseRes.status()})`);
      }
    }

    summaryVersion += 1;
    const seedSummaryRes = await userAApi.put(
      `/api/v1/folders/${folderId}?workspace_id=${encodeURIComponent(workspaceId)}`,
      {
        data: {
          executiveSummary: buildExecutiveSummary(`seed-${summaryVersion}`),
        },
      }
    );
    if (!seedSummaryRes.ok()) {
      throw new Error(`Cannot seed executive summary (status ${seedSummaryRes.status()})`);
    }

    await userAApi.dispose();
  });

  test('viewer sees read-only lock icon on dashboard', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceAndFolderStorageState(USER_B_STATE, workspaceId, folderId),
    });
    const page = await context.newPage();

    try {
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');

      const readOnlyLockButton = page.locator(
        'button.print-hidden[aria-label*="lecture seule"], button.print-hidden[aria-label*="read-only"]'
      );
      const presenceLockGroup = page.locator(
        'div[role="group"][aria-label*="Verrou"], div[role="group"][aria-label*="Lock"]'
      );

      await expect
        .poll(
          async () => (await readOnlyLockButton.count()) + (await presenceLockGroup.count()),
          { timeout: 2_000 }
        )
        .toBeGreaterThan(0);

      if ((await readOnlyLockButton.count()) > 0) {
        await expect(readOnlyLockButton.first()).toBeVisible({ timeout: 2_000 });
        await expect(readOnlyLockButton.first()).toHaveClass(/print-hidden/);
      } else {
        await expect(presenceLockGroup.first()).toBeVisible({ timeout: 2_000 });
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test('menu flow: Prepare -> (Preparing|direct) -> Download', async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({
      storageState: await withWorkspaceAndFolderStorageState(USER_A_STATE, workspaceId, folderId),
      acceptDownloads: true,
    });
    const page = await context.newPage();

    try {
      await page.addInitScript(
        ({ targetWorkspaceId, targetFolderId }) => {
          window.localStorage.setItem('workspaceScopeId', targetWorkspaceId);
          window.localStorage.setItem('currentFolderId', targetFolderId);
        },
        { targetWorkspaceId: workspaceId, targetFolderId: folderId }
      );
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByRole('heading', { level: 1, name: folderName })).toBeVisible({ timeout: 2_000 });

      summaryVersion += 1;
      await updateExecutiveSummary(page, `prepare-${summaryVersion}`);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await waitForDocxMenuState(page, 'prepare', 20_000);

      await openActionsMenu(page);
      const prepareItem = getDocxPrepareButton(page);
      await expect(prepareItem).toBeEnabled();
      const [generateResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/api/v1/docx/generate') && res.request().method() === 'POST'),
        prepareItem.click(),
      ]);
      if (!generateResponse.ok()) {
        const errorBody = await generateResponse.text().catch(() => '');
        throw new Error(`DOCX generate request failed (${generateResponse.status()}): ${errorBody}`);
      }
      const payload = (await generateResponse.json().catch(() => null)) as
        | { jobId?: string; status?: string }
        | null;
      if (payload?.status !== 'completed') {
        await expect(page.getByRole('alert').filter({ hasText: DOCX_STARTED_TOAST }).first()).toBeVisible({
          timeout: 8_000,
        });
      }
      if (payload?.jobId && payload.status !== 'completed') {
        await expect
          .poll(async () => getDocxMenuState(page), {
            timeout: 12_000,
            intervals: [300, 500, 800],
          })
          .toBe('preparing');
        await waitForDocxJobCompletion(page, payload.jobId, 55_000);
      }
      const readyToast = page.getByRole('alert').filter({ hasText: DOCX_READY_TOAST }).first();
      await expect(readyToast).toBeVisible({ timeout: 55_000 });
      await expect(readyToast.getByRole('button', { name: DOCX_DOWNLOAD_LABEL })).toBeVisible();
      await waitForDocxMenuState(page, 'download', 55_000);

      await openActionsMenu(page);
      const downloadItem = getDocxDownloadButton(page);
      await expect(downloadItem).toBeVisible();
      await expect(downloadItem).toBeEnabled();

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        downloadItem.click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^executive-synthesis-.*\.docx$/i);
      await waitForDocxMenuState(page, 'prepare', 20_000);
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test('DOCX state invalidates back to Prepare after executive summary change', async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });
    const page = await context.newPage();

    try {
      await page.addInitScript(({ targetWorkspaceId, targetFolderId }) => {
        window.localStorage.setItem('workspaceScopeId', targetWorkspaceId);
        window.localStorage.setItem('currentFolderId', targetFolderId);
      }, { targetWorkspaceId: workspaceId, targetFolderId: folderId });

      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');

      await prepareDocxIfNeeded(page);

      summaryVersion += 1;
      await updateExecutiveSummary(page, `invalidate-${summaryVersion}`);

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await waitForDocxMenuState(page, 'prepare', 20_000);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});
