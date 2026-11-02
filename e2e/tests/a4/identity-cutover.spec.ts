import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { registerA4BrowserUser } from './identity-browser-fixture';

const apiBase = process.env.API_BASE_URL || 'http://localhost:8787';

test('F11 registration, independent approvals, members, suspension and login', async ({ browser, page }) => {
  const email = `a4-${randomUUID()}@example.test`;
  const user = await registerA4BrowserUser(browser, email);
  const headers = { authorization: `Bearer ${user.sessionToken}` };
  const get = (path: string) => user.context.request.get(`${apiBase}/api/v1${path}`, { headers });
  try {
    await page.addInitScript(() => localStorage.setItem('locale', 'en'));
    const workspacesResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspaces') && response.request().method() === 'GET');
    await page.goto('/settings');
    const workspaces = await (await workspacesResponse).json() as { items: Array<{ id: string; role: string; type: string }> };
    const shared = workspaces.items.find(workspace => workspace.role === 'admin' && workspace.type !== 'neutral');
    if (!shared) throw Error('The qualified admin workspace fixture is missing');
    const own = await (await get('/workspaces')).json() as { items: Array<{ id: string }> };
    if (!own.items[0]) throw Error('Registration provisioned no workspace');
    const ownCatalog = `/catalog/entries?workspace_id=${encodeURIComponent(own.items[0].id)}`;
    expect((await get(ownCatalog)).status()).toBe(403);

    const account = page.getByRole('row').filter({ hasText: email });
    await expect(account).toContainText('Pending admin approval');
    await account.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(account).toContainText('Active');
    // Account approval never silently approves membership, even on the existing login.
    expect((await get(ownCatalog)).status()).toBe(403);

    await user.page.goto('/settings/memberships');
    await user.page.getByLabel('Tenant identifier', { exact: true }).fill('sentropic');
    await user.page.getByRole('button', { name: 'Request membership', exact: true }).click();
    await expect(user.page.getByText('Your membership request has been received.', { exact: true })).toBeVisible();
    await page.goto('/settings/memberships');
    await page.getByLabel('Tenant identifier', { exact: true }).fill('sentropic');
    await page.getByRole('button', { name: 'Load decisions', exact: true }).click();
    const membership = page.getByRole('row').filter({ hasText: user.userId });
    await expect(membership).toContainText('Requested');
    await membership.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(membership).toContainText('Approved');
    const allowed = await get(ownCatalog);
    expect(allowed.status()).toBe(200);
    expect((await allowed.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);

    await page.goto('/settings');
    await page.evaluate(id => localStorage.setItem('workspaceScopeId', id), shared.id);
    await page.reload();
    const members = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Members', exact: true }) });
    await members.getByLabel('Email', { exact: true }).fill(email);
    await members.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(members.getByRole('row').filter({ hasText: email })).toBeVisible();
    const sharedCatalog = `/catalog/entries?workspace_id=${encodeURIComponent(shared.id)}`;
    expect((await get(sharedCatalog)).status()).toBe(200);

    await page.goto('/settings/memberships');
    await page.getByLabel('Tenant identifier', { exact: true }).fill('sentropic');
    await page.getByRole('button', { name: 'Load decisions', exact: true }).click();
    await membership.getByRole('button', { name: 'Suspend', exact: true }).click();
    await expect(membership).toContainText('Suspended');
    expect((await get('/session')).status()).toBe(200);
    const refused = await get(sharedCatalog);
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual({ error: 'catalog_access_denied' });

    await membership.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(membership).toContainText('Approved');
    const revoked = await user.context.request.delete(`${apiBase}/api/v1/session/all`, { headers });
    expect(revoked.status()).toBe(200);
    expect((await get('/session')).status()).toBe(401);
    await user.context.clearCookies();
    await user.page.evaluate(() => sessionStorage.clear());
    await user.page.goto('/auth/login?returnUrl=/settings');
    const login = user.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/login/verify'));
    await user.page.getByRole('button', { name: 'Sign in with passkey', exact: true }).click();
    expect((await login).status()).toBe(200);
    await expect(user.page).toHaveURL(/\/settings$/);
    expect((await get('/session')).status()).toBe(401); // A new login never resurrects the revoked one.
  } finally { await user.context.close(); }
});
