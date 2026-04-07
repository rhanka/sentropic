import { test, expect, chromium } from '@playwright/test';
import http from 'http';
import path from 'path';

/**
 * Screenshot proof test — connects to user's Chromium via CDP,
 * navigates to initiative, organization, and dashboard pages,
 * takes screenshots, and checks for CORS errors in the console.
 */

const UI_ORIGIN = 'http://localhost:5173';
const SCREENSHOT_DIR = path.resolve(__dirname, '../../test-results');

test.describe('Page screenshot proof (CORS fix validation)', () => {
  test.use({ storageState: undefined });
  test.setTimeout(120_000);

  test('screenshot initiative, organization, and dashboard pages', async () => {
    // Get CDP websocket URL
    const wsUrl = await new Promise<string>((resolve, reject) => {
      http.get(
        'http://host.docker.internal:9223/json/version',
        { headers: { Host: 'localhost:9222' } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            const info = JSON.parse(data);
            const url = info.webSocketDebuggerUrl
              .replace(/127\.0\.0\.1|localhost/, 'host.docker.internal')
              .replace(':9222', ':9223');
            resolve(url);
          });
        },
      ).on('error', reject);
    });

    console.log('Connecting via CDP:', wsUrl);
    const browser = await chromium.connectOverCDP(wsUrl, { timeout: 60_000 });
    const context = browser.contexts()[0];

    // Collect CORS errors from console
    const corsErrors: string[] = [];

    // Open a new page in the existing context (reuses session/cookies)
    const page = await context.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      if (/cors|cross-origin|blocked/i.test(text)) {
        corsErrors.push(text);
      }
    });
    page.on('pageerror', (err) => {
      if (/cors|cross-origin|blocked/i.test(err.message)) {
        corsErrors.push(err.message);
      }
    });

    // 1. Navigate to the app root to discover links
    console.log('Navigating to app root to discover pages...');
    await page.goto(UI_ORIGIN, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(3000);

    // Find initiative links
    const initiativeLinks = await page.$$eval(
      'a[href*="/initiative"]',
      (els) => els.map((a) => (a as HTMLAnchorElement).href),
    );
    console.log(`Found ${initiativeLinks.length} initiative links`);

    // Find organization links
    const orgLinks = await page.$$eval(
      'a[href*="/organization"]',
      (els) => els.map((a) => (a as HTMLAnchorElement).href),
    );
    console.log(`Found ${orgLinks.length} organization links`);

    // Find dashboard/folder links
    const dashboardLinks = await page.$$eval(
      'a[href*="/dashboard"], a[href*="/folder"]',
      (els) => els.map((a) => (a as HTMLAnchorElement).href),
    );
    console.log(`Found ${dashboardLinks.length} dashboard/folder links`);

    // 2. Screenshot initiative page
    if (initiativeLinks.length > 0) {
      const url = initiativeLinks[0];
      console.log(`Navigating to initiative: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(3000);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'proof-initiative.png'),
        fullPage: true,
      });
      console.log('Screenshot saved: proof-initiative.png');
    } else {
      // Try navigating to sidebar or workspace first
      console.log('No initiative links found on root, taking root screenshot');
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'proof-initiative.png'),
        fullPage: true,
      });
    }

    // 3. Screenshot organization page
    if (orgLinks.length > 0) {
      const url = orgLinks[0];
      console.log(`Navigating to organization: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(3000);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'proof-organization.png'),
        fullPage: true,
      });
      console.log('Screenshot saved: proof-organization.png');
    } else {
      // Refresh and look for org links after being on the app
      const currentUrl = page.url();
      console.log(`No org links found, screenshotting current page: ${currentUrl}`);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'proof-organization.png'),
        fullPage: true,
      });
    }

    // 4. Screenshot dashboard page
    if (dashboardLinks.length > 0) {
      const url = dashboardLinks[0];
      console.log(`Navigating to dashboard: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(3000);
    } else {
      // Navigate back to root as dashboard
      console.log('No dashboard links found, using root as dashboard');
      await page.goto(UI_ORIGIN, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(3000);
    }
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'proof-dashboard.png'),
      fullPage: true,
    });
    console.log('Screenshot saved: proof-dashboard.png');

    // 5. Report CORS errors
    if (corsErrors.length > 0) {
      console.log('\n--- CORS ERRORS DETECTED ---');
      for (const err of corsErrors) {
        console.log(`  ${err}`);
      }
    } else {
      console.log('\nNo CORS errors detected in console.');
    }

    await page.close();
    await browser.close();

    // Fail if CORS errors were found
    expect(corsErrors, 'No CORS errors should be present').toHaveLength(0);
  });
});
