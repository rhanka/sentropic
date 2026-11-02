import { expect, type Browser } from '@playwright/test';
import { extractVerificationCode, getLatestEmailForRecipient } from '../../helpers/maildev';

/** Real browser authenticator, verifier and mail service; no credential-service stub. */
export async function registerA4BrowserUser(browser: Browser, email: string) {
  const context = await browser.newContext({ baseURL: process.env.UI_BASE_URL || 'http://localhost:5173',
    storageState: { cookies: [], origins: [] } });
  try {
    await context.addInitScript(() => localStorage.setItem('locale', 'en'));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    } });
    await page.goto('/auth/register?returnUrl=/settings');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Get verification code', exact: true }).click();
    let code: string | null = null;
    await expect.poll(async () => {
      const mail = await getLatestEmailForRecipient(email);
      code = mail ? extractVerificationCode(mail) : null;
      return Boolean(code);
    }).toBe(true);
    await page.getByLabel('Verification code', { exact: true }).fill(code!);
    await page.getByRole('button', { name: 'Verify code', exact: true }).click();
    const verified = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/register/verify'));
    await page.getByRole('button', { name: 'Register my WebAuthn device', exact: true }).click();
    const response = await verified;
    expect(response.status()).toBe(200);
    const result = await response.json() as { user: { id: string }; sessionToken: string };
    if (!result.user?.id || !result.sessionToken) throw Error('Registration returned no session');
    await expect(page).toHaveURL(/\/settings$/);
    return { context, page, userId: result.user.id, sessionToken: result.sessionToken };
  } catch (error) { await context.close(); throw error; }
}
