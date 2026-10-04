import { test, expect, request, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test('preserves the key UI surfaces after the tooling migration', async ({ browser }, testInfo) => {
  const phaseFile = './.auth/tooling-visual-phase.json';
  let phase = 'after';
  try { phase = JSON.parse(readFileSync(phaseFile, 'utf8')).phase; } catch { /* Default CI capture. */ }
  const output = `test-results/tooling-visual/${phase}`;
  mkdirSync(output, { recursive: true });
  const capture = async (page: Page, name: string) => {
    await page.evaluate(() => document.fonts.ready);
    const path = `${output}/${name}.png`;
    await page.screenshot({ path, fullPage: true, animations: 'disabled' });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  };
  const anonymous = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const login = await anonymous.newPage();
  await login.goto('/auth/login');
  await expect(login.getByLabel('Email')).toBeVisible();
  await capture(login, 'login');
  await anonymous.close();

  const api = await request.newContext({
    baseURL: process.env.API_BASE_URL,
    storageState: './.auth/user-a.json',
  });
  const workspaceResponse = await api.post('/api/v1/workspaces', {
    data: { name: 'Tooling visual reference' },
  });
  expect(workspaceResponse.ok()).toBe(true);
  const workspace = await workspaceResponse.json();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: await withWorkspaceStorageState('./.auth/user-a.json', workspace.id),
  });
  try {
    const organizationResponse = await api.post(`/api/v1/organizations?workspace_id=${workspace.id}`, {
      data: { name: 'Visual reference organization', status: 'completed', description: 'Stable migration reference.' },
    });
    expect(organizationResponse.ok()).toBe(true);
    const organization = await organizationResponse.json();
    const page = await context.newPage();
    await page.goto('/home');
    await expect(page.locator('main')).toBeVisible();
    await capture(page, 'home');
    await page.goto('/organizations');
    await expect(page.getByText('Visual reference organization').first()).toBeVisible();
    await capture(page, 'list');
    await page.goto(`/organizations/${organization.id}`);
    await expect(page.getByText('Visual reference organization').first()).toBeVisible();
    await capture(page, 'detail');
    await page.locator('button[aria-controls="chat-widget-dialog"]').click();
    await expect(page.locator('#chat-widget-dialog')).toBeVisible();
    await capture(page, 'chat');
  } finally {
    await context.close();
    await api.delete(`/api/v1/workspaces/${workspace.id}`);
    await api.dispose();
  }
});
