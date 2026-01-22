import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

export async function withWorkspaceStorageState(storagePath: string, workspaceId: string) {
  const raw = JSON.parse(await readFile(storagePath, 'utf-8'));
  const origin = process.env.UI_BASE_URL || 'http://localhost:5173';
  const origins = Array.isArray(raw.origins) ? raw.origins : [];
  let entry = origins.find((o: { origin: string }) => o.origin === origin);
  if (!entry) {
    entry = { origin, localStorage: [] };
    origins.push(entry);
  }
  const localStorage = Array.isArray(entry.localStorage) ? entry.localStorage : [];
  const existing = localStorage.find((item: { name: string }) => item.name === 'workspaceScopeId');
  if (existing) existing.value = workspaceId;
  else localStorage.push({ name: 'workspaceScopeId', value: workspaceId });
  entry.localStorage = localStorage;
  raw.origins = origins;
  return raw;
}

export async function withWorkspaceAndFolderStorageState(
  storagePath: string,
  workspaceId: string,
  folderId: string
) {
  const raw = await withWorkspaceStorageState(storagePath, workspaceId);
  const origin = process.env.UI_BASE_URL || 'http://localhost:5173';
  const origins = Array.isArray(raw.origins) ? raw.origins : [];
  const entry = origins.find((o: { origin: string }) => o.origin === origin);
  if (!entry) return raw;
  const localStorage = Array.isArray(entry.localStorage) ? entry.localStorage : [];
  const existing = localStorage.find((item: { name: string }) => item.name === 'currentFolderId');
  if (existing) existing.value = folderId;
  else localStorage.push({ name: 'currentFolderId', value: folderId });
  entry.localStorage = localStorage;
  raw.origins = origins;
  return raw;
}

export async function warmUpWorkspaceScope(page: Page, workspaceName: string, workspaceId: string) {
  await page.goto('/parametres');
  await page.waitForLoadState('domcontentloaded');

  let selected = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = page.locator('tbody tr');
    try {
      await expect(rows.first()).toBeVisible({ timeout: 2_000 });
    } catch {
      if (attempt < 2) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        continue;
      }
    }

    const selectedInput = page.locator(`input[value="${workspaceName}"]`).first();
    if (await selectedInput.count()) {
      await expect(selectedInput).toBeVisible({ timeout: 2_000 });
      selected = true;
    } else {
      const row = rows.filter({ hasText: workspaceName }).first();
      if (await row.count()) {
        await expect(row).toBeVisible({ timeout: 2_000 });
        await row.click();
        selected = true;
      }
    }

    if (selected) break;
    if (attempt < 2) {
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
  }

  if (!selected) {
    throw new Error(`Workspace introuvable dans /parametres: ${workspaceName}`);
  }

  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem('workspaceScopeId')), { timeout: 2_000 })
    .toBe(workspaceId);
}
