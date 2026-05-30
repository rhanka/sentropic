import { test, expect, request } from '@playwright/test';
import { withWorkspaceAndFolderStorageState } from '../helpers/workspace-scope';

// BR-40a: prioritization matrix at scale — top-10 labels, hide-bubbles toggle,
// business-domain legend (filterable + hover emphasis).
test.describe('Prioritization matrix at scale (BR-40a)', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';

  // Default-matrix axis ids (api/src/config/default-matrix.ts).
  const VALUE_AXES = ['business_value', 'time_criticality', 'risk_reduction_opportunity'];
  const COMPLEXITY_AXES = [
    'ai_maturity',
    'implementation_effort',
    'data_compliance',
    'data_availability',
    'change_management',
  ];

  const DOMAINS = ['Marketing', 'Finance', 'Operations'];

  let workspaceId = '';
  let organizationId = '';
  let folderId = '';

  const buildScores = (axisIds: string[], rating: number) =>
    axisIds.map((axisId) => ({ axisId, rating, description: 'E2E seed' }));

  test.beforeAll(async () => {
    const api = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });

    const wsRes = await api.post('/api/v1/workspaces', {
      data: { name: `Matrix Scale ${Date.now()}` },
    });
    if (!wsRes.ok()) throw new Error(`Cannot create workspace (status ${wsRes.status()})`);
    workspaceId = String((await wsRes.json())?.id || '');
    if (!workspaceId) throw new Error('workspaceId missing');

    const orgRes = await api.post(
      `/api/v1/organizations?workspace_id=${encodeURIComponent(workspaceId)}`,
      { data: { name: `Matrix Org ${Date.now()}`, data: { industry: 'E2E' } } }
    );
    if (!orgRes.ok()) throw new Error(`Cannot create organization (status ${orgRes.status()})`);
    organizationId = String((await orgRes.json())?.id || '');

    const folderRes = await api.post(
      `/api/v1/folders?workspace_id=${encodeURIComponent(workspaceId)}`,
      {
        data: {
          name: `Matrix Folder ${Date.now()}`,
          description: 'BR-40a prioritization matrix folder',
          organizationId,
        },
      }
    );
    if (!folderRes.ok()) throw new Error(`Cannot create folder (status ${folderRes.status()})`);
    folderId = String((await folderRes.json())?.id || '');
    if (!folderId) throw new Error('folderId missing');

    // Seed 12 completed use cases across 3 domains with varied value/complexity
    // scores, so the top-10 label rule and the domain legend are both exercised.
    for (let i = 0; i < 12; i++) {
      const valueRating = ((i * 7) % 100) + 1; // spread 1..100
      const complexityRating = ((i * 13) % 100); // spread 0..99 (complexity can be 0)
      const res = await api.post(
        `/api/v1/use-cases?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          data: {
            folderId,
            organizationId,
            name: `Matrix UC ${i + 1}`,
            problem: `Problem ${i + 1}`,
            solution: `Solution ${i + 1}`,
            domain: DOMAINS[i % DOMAINS.length],
            valueScores: buildScores(VALUE_AXES, valueRating),
            complexityScores: buildScores(COMPLEXITY_AXES, complexityRating),
          },
        }
      );
      if (!res.ok()) throw new Error(`Cannot create use case ${i + 1} (status ${res.status()})`);
    }

    await api.dispose();
  });

  test('renders the business-domain legend with a chip per seeded domain', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceAndFolderStorageState(USER_A_STATE, workspaceId, folderId),
    });
    const page = await context.newPage();
    try {
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');

      const legend = page.locator('.scatter-plot-legend');
      await expect(legend).toBeVisible({ timeout: 5_000 });

      for (const domain of DOMAINS) {
        await expect(
          legend.getByRole('button', { name: new RegExp(domain) })
        ).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test('toggles the hide-labels icon control', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceAndFolderStorageState(USER_A_STATE, workspaceId, folderId),
    });
    const page = await context.newPage();
    try {
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');

      // Icon-only button: accessible name comes from its aria-label (state-aware).
      const hideBtn = page.getByRole('button', { name: /Hide labels|Masquer les étiquettes/i });
      await expect(hideBtn).toBeVisible({ timeout: 5_000 });
      await expect(hideBtn).toHaveAttribute('aria-pressed', 'false');
      await hideBtn.click();

      const showBtn = page.getByRole('button', { name: /Show labels|Afficher les étiquettes/i });
      await expect(showBtn).toBeVisible();
      await expect(showBtn).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await context.close();
    }
  });

  test('filters a business domain off via the legend (aria-pressed toggles)', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceAndFolderStorageState(USER_A_STATE, workspaceId, folderId),
    });
    const page = await context.newPage();
    try {
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');

      const legend = page.locator('.scatter-plot-legend');
      await expect(legend).toBeVisible({ timeout: 5_000 });

      const chip = legend.getByRole('button', { name: new RegExp(DOMAINS[0]) }).first();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await context.close();
    }
  });
});
