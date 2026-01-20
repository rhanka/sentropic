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
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });

  const selectedInput = page.locator(`input[value="${workspaceName}"]`).first();
  if (await selectedInput.count()) {
    await expect(selectedInput).toBeVisible({ timeout: 10_000 });
  } else {
    const row = rows.filter({ hasText: workspaceName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
  }
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem('workspaceScopeId')), { timeout: 10_000 })
    .toBe(workspaceId);
}
