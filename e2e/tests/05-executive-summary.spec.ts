import { test, expect, request } from '@playwright/test';
import { withWorkspaceAndFolderStorageState } from '../helpers/workspace-scope';

test.describe('Executive summary rendering', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';

  let workspaceId = '';
  let organizationId = '';
  let folderId = '';
  const useCaseTitles: string[] = [];

  const executiveSummary = {
    synthese_executive: 'Synthèse E2E multi-page',
    introduction: 'Introduction E2E for executive summary print checks.',
    analyse: 'Analyse E2E for executive summary print checks.',
    recommandation: 'Recommandation E2E for executive summary print checks.',
    references: [
      { title: 'Reference A', url: 'https://example.com/reference-a' },
      { title: 'Reference B', url: 'https://example.com/reference-b' },
    ],
  };

  test.beforeAll(async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    const workspaceName = `Executive Summary ${Date.now()}`;
    const createWorkspaceRes = await userAApi.post('/api/v1/workspaces', {
      data: { name: workspaceName },
    });
    if (!createWorkspaceRes.ok()) {
      throw new Error(`Cannot create workspace (status ${createWorkspaceRes.status()})`);
    }
    const createdWorkspace = await createWorkspaceRes.json().catch(() => null);
    workspaceId = String(createdWorkspace?.id || '');
    if (!workspaceId) throw new Error('workspaceId is missing');

    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${encodeURIComponent(workspaceId)}`, {
      data: {
        name: `Exec Summary Org ${Date.now()}`,
        data: { industry: 'E2E' },
      },
    });
    if (!orgRes.ok()) {
      throw new Error(`Cannot create organization (status ${orgRes.status()})`);
    }
    const createdOrg = await orgRes.json().catch(() => null);
    organizationId = String(createdOrg?.id || '');
    if (!organizationId) throw new Error('organizationId is missing');

    const folderRes = await userAApi.post(`/api/v1/folders?workspace_id=${encodeURIComponent(workspaceId)}`, {
      data: {
        name: `Executive Summary Folder ${Date.now()}`,
        description: 'E2E folder for executive summary print checks',
        organizationId,
      },
    });
    if (!folderRes.ok()) {
      throw new Error(`Cannot create folder (status ${folderRes.status()})`);
    }
    const createdFolder = await folderRes.json().catch(() => null);
    folderId = String(createdFolder?.id || '');
    if (!folderId) throw new Error('folderId is missing');

    const createdUseCaseTitles = [
      `Annex E2E Use Case Alpha ${Date.now()}`,
      `Annex E2E Use Case Beta ${Date.now()}`,
      `Annex E2E Use Case Gamma ${Date.now()}`,
    ];

    for (const title of createdUseCaseTitles) {
      const useCaseRes = await userAApi.post(`/api/v1/use-cases?workspace_id=${encodeURIComponent(workspaceId)}`, {
        data: {
          folderId,
          organizationId,
          name: title,
          problem: `Problem for ${title}`,
          solution: `Solution for ${title}`,
        },
      });
      if (!useCaseRes.ok()) {
        throw new Error(`Cannot create use case \"${title}\" (status ${useCaseRes.status()})`);
      }
      useCaseTitles.push(title);
    }

    const summaryRes = await userAApi.put(
      `/api/v1/folders/${folderId}?workspace_id=${encodeURIComponent(workspaceId)}`,
      {
        data: {
          executiveSummary,
        },
      }
    );
    if (!summaryRes.ok()) {
      throw new Error(`Cannot set executive summary (status ${summaryRes.status()})`);
    }

    await userAApi.dispose();
  });

  test('keeps executive summary sections ordered and TOC links wired', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceAndFolderStorageState(USER_A_STATE, workspaceId, folderId),
    });
    const page = await context.newPage();

    try {
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('heading', { name: /Synthèse exécutive|Executive summary/i }).first()).toBeVisible({
        timeout: 15_000,
      });

      const intro = page.locator('#section-introduction');
      const analysis = page.locator('#section-analyse');
      const recommendations = page.locator('#section-recommandations');

      await expect(intro).toBeVisible();
      await expect(analysis).toBeVisible();
      await expect(recommendations).toBeVisible();

      const introBox = await intro.boundingBox();
      const analysisBox = await analysis.boundingBox();
      const recommendationsBox = await recommendations.boundingBox();
      expect(introBox).not.toBeNull();
      expect(analysisBox).not.toBeNull();
      expect(recommendationsBox).not.toBeNull();
      expect((introBox as NonNullable<typeof introBox>).y).toBeLessThan((analysisBox as NonNullable<typeof analysisBox>).y);
      expect((analysisBox as NonNullable<typeof analysisBox>).y).toBeLessThan((recommendationsBox as NonNullable<typeof recommendationsBox>).y);

      const introTocLinkCount = await page.locator('a.toc-link[href="#section-introduction"]').count();
      const analysisTocLinkCount = await page.locator('a.toc-link[href="#section-analyse"]').count();
      const recommendationsTocLinkCount = await page
        .locator('a.toc-link[href="#section-recommandations"]')
        .count();
      expect(introTocLinkCount).toBeGreaterThan(0);
      expect(analysisTocLinkCount).toBeGreaterThan(0);
      expect(recommendationsTocLinkCount).toBeGreaterThan(0);

      const nestedLinks = page.locator('.toc-item-nested a.toc-link');
      expect(await nestedLinks.count()).toBeGreaterThanOrEqual(useCaseTitles.length);
      for (const title of useCaseTitles) {
        expect(await nestedLinks.filter({ hasText: title }).count()).toBeGreaterThan(0);
      }
    } finally {
      await context.close();
    }
  });

  test('renders annex sections for all use cases in print mode without empty annex blocks', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceAndFolderStorageState(USER_A_STATE, workspaceId, folderId),
    });
    const page = await context.newPage();

    try {
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');
      await page.emulateMedia({ media: 'print' });

      const annexSections = page.locator('.usecase-annex-section');
      await expect(annexSections).toHaveCount(useCaseTitles.length);

      const renderedTitles = await annexSections.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-usecase-title') || '').filter((value) => value.length > 0)
      );
      expect(renderedTitles).toEqual(expect.arrayContaining(useCaseTitles));

      const textLengths = await annexSections.evaluateAll((nodes) =>
        nodes.map((node) => (node.textContent || '').trim().length)
      );
      for (const length of textLengths) {
        expect(length).toBeGreaterThan(30);
      }

      const tocPages = await page.locator('.toc-item-nested .toc-page').allTextContents();
      expect(tocPages).toHaveLength(useCaseTitles.length);
      const parsedPages = tocPages.map((value) => Number.parseInt(value.trim(), 10));
      parsedPages.forEach((pageNumber) => expect(Number.isFinite(pageNumber)).toBe(true));
      for (let idx = 1; idx < parsedPages.length; idx += 1) {
        expect(parsedPages[idx]).toBeGreaterThanOrEqual(parsedPages[idx - 1]);
      }
    } finally {
      await context.close();
    }
  });
});
