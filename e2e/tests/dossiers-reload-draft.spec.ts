import { test, expect } from '@playwright/test';

test.describe('Dossiers — reload & brouillons', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

  test.beforeEach(async ({ page }) => {
    // Stabiliser: forcer le scope admin sur la workspace admin (sinon mode "lecture seule" possible).
    await page.addInitScript((id: string) => {
      try {
        localStorage.setItem('adminWorkspaceScopeId', id);
      } catch {
        // ignore
      }
    }, ADMIN_WORKSPACE_ID);
  });

  test('CTRL+R: reload sur /dossiers/[id] ne casse pas (fallback SPA)', async ({ page }) => {
    // Récupérer un dossier existant via API (seed E2E)
    const foldersRes = await page.request.get(`${API_BASE_URL}/api/v1/folders`);
    expect(foldersRes.ok()).toBeTruthy();
    const foldersJson = await foldersRes.json().catch(() => null);
    const items: any[] = (foldersJson as any)?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    const folderId = String(items[0]?.id ?? '');
    expect(folderId).toBeTruthy();

    await page.goto(`/dossiers/${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');

    // Signal minimal que la page est hydratée
    await expect(page.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });

    // Simuler un refresh (CTRL+R). On utilise reload() (équivalent E2E).
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Toujours OK après reload
    await expect(page.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Draft: cliquer la carte “Brouillon” renvoie vers /dossier/new?draft=...', async ({ page }) => {
    // Créer un draft dédié (évite les flakys + dépendance au seed)
    const draftName = `E2E Draft ${Date.now()}`;
    const draftRes = await page.request.post(`${API_BASE_URL}/api/v1/folders/draft`, {
      data: { name: draftName, description: 'Draft created by dossiers-reload-draft.spec.ts' }
    });
    expect(draftRes.ok()).toBeTruthy();
    const draftJson = await draftRes.json().catch(() => null);
    const draftId = String((draftJson as any)?.id ?? '');
    expect(draftId).toBeTruthy();

    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');

    const draftCard = page.locator('.grid.gap-4 > article').filter({ hasText: draftName }).first();
    await expect(draftCard).toBeVisible({ timeout: 10_000 });

    await draftCard.click();
    await page.waitForURL(new RegExp(`/dossier/new\\?draft=${draftId}$`), { timeout: 10_000 });

    // Vérifier que le nom est bien celui du draft (EditableInput dans H1)
    const nameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await expect(nameInput).toHaveValue(draftName);
  });
});


