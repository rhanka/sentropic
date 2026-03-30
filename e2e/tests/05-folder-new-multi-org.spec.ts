import { test, expect } from '@playwright/test';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Dossier · creation multi-org minimale', () => {
  const ADMIN_STATE = './.auth/state.json';
  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

  test('envoie org_ids et create_new_orgs depuis /folder/new', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(ADMIN_STATE, ADMIN_WORKSPACE_ID),
    });
    const page = await context.newPage();

    let capturedGeneratePayload: Record<string, unknown> | null = null;

    await page.route('**/api/v1/organizations*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { id: 'org-alpha', name: 'Org Alpha', hasMatrixTemplate: true },
            { id: 'org-beta', name: 'Org Beta', hasMatrixTemplate: false },
          ],
        }),
      });
    });

    await page.route('**/api/v1/folders/draft*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'folder-ui-multi-org',
          name: 'Brouillon',
          description: '',
          organizationId: null,
          createdAt: new Date().toISOString(),
          status: 'draft',
        }),
      });
    });

    await page.route('**/api/v1/folders/folder-ui-multi-org*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'folder-ui-multi-org',
          name: 'Brouillon',
          description: '',
          organizationId: null,
          createdAt: new Date().toISOString(),
          status: 'draft',
        }),
      });
    });

    await page.route('**/api/v1/initiatives/generate*', async (route) => {
      capturedGeneratePayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: 'generating',
          folder_id: 'folder-ui-multi-org',
          created_folder_id: 'folder-ui-multi-org',
          jobId: 'job-ui-multi-org',
          workflow_run_id: 'run-ui-multi-org',
        }),
      });
    });

    await page.goto('/folder/new');
    await page.waitForURL(/\/folder\/new$/, { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');

    const organizationsTrigger = page.getByRole('button', { name: 'Organisations ciblées (optionnel)' });
    await expect(organizationsTrigger).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Générer une matrice ad hoc pour ce dossier')).toBeVisible();
    await expect(page.getByLabel('Créer de nouvelles organisations automatiquement')).toBeVisible();

    await organizationsTrigger.click();
    const orgAlphaOption = page.getByRole('menuitemcheckbox', { name: 'Org Alpha' });
    const orgBetaOption = page.getByRole('menuitemcheckbox', { name: 'Org Beta' });
    await expect(orgAlphaOption).toBeVisible({ timeout: 10_000 });
    await orgAlphaOption.click();
    await orgBetaOption.click();
    await expect(organizationsTrigger).toContainText('2 organisations sélectionnées');
    await organizationsTrigger.click();
    await page.getByLabel('Créer de nouvelles organisations automatiquement').check();

    const generateButton = page.locator('button[title="IA"][aria-label="IA"]').first();
    await expect(generateButton).toBeEnabled();
    await generateButton.click();
    await expect.poll(() => Boolean(capturedGeneratePayload), { timeout: 15_000 }).toBe(true);

    expect(capturedGeneratePayload).toBeTruthy();
    expect(capturedGeneratePayload).toMatchObject({
      create_new_orgs: true,
      matrix_mode: 'generate',
      org_ids: ['org-alpha', 'org-beta'],
    });
    expect(capturedGeneratePayload?.organization_id).toBeUndefined();
    expect(typeof capturedGeneratePayload?.folder_id).toBe('string');
    expect(String(capturedGeneratePayload?.folder_id || '').trim().length).toBeGreaterThan(0);

    await context.close();
  });

  test('autorise une generation generique avec le titre seul', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(ADMIN_STATE, ADMIN_WORKSPACE_ID),
    });
    const page = await context.newPage();

    let capturedGeneratePayload: Record<string, unknown> | null = null;

    await page.route('**/api/v1/organizations*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
    });

    await page.route('**/api/v1/folders/draft*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'folder-ui-generic-title',
          name: 'Digital twin manufacturier',
          description: '',
          organizationId: null,
          createdAt: new Date().toISOString(),
          status: 'draft',
        }),
      });
    });

    await page.route('**/api/v1/folders/folder-ui-generic-title*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'folder-ui-generic-title',
          name: 'Digital twin manufacturier',
          description: '',
          organizationId: null,
          createdAt: new Date().toISOString(),
          status: 'draft',
        }),
      });
    });

    await page.route('**/api/v1/initiatives/generate*', async (route) => {
      capturedGeneratePayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: 'generating',
          folder_id: 'folder-ui-generic-title',
          created_folder_id: 'folder-ui-generic-title',
          jobId: 'job-ui-generic-title',
          workflow_run_id: 'run-ui-generic-title',
        }),
      });
    });

    await page.goto('/folder/new');
    await page.waitForURL(/\/folder\/new$/, { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByLabel('Créer de nouvelles organisations automatiquement')).toBeVisible();
    await expect(page.getByText('Générer une matrice ad hoc pour ce dossier')).toBeVisible();

    await page.getByRole('textbox', { name: 'Nom du dossier' }).fill('Digital twin manufacturier');

    const generateButton = page.locator('button[title="IA"][aria-label="IA"]').first();
    await expect(generateButton).toBeEnabled();
    await generateButton.click();
    await expect.poll(() => Boolean(capturedGeneratePayload), { timeout: 15_000 }).toBe(true);

    expect(capturedGeneratePayload).toBeTruthy();
    expect(capturedGeneratePayload).toMatchObject({
      input: 'Digital twin manufacturier',
      matrix_mode: 'generate',
    });
    expect(capturedGeneratePayload?.org_ids).toBeUndefined();
    expect(capturedGeneratePayload?.organization_id).toBeUndefined();

    await context.close();
  });
});
