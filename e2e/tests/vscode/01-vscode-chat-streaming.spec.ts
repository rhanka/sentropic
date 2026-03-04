import { expect, test } from '@playwright/test';

const OPENVSCODE_BASE_URL =
  process.env.OPENVSCODE_BASE_URL || 'http://localhost:3115';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';

test.describe('VSCode lane smoke', () => {
  test('openvscode host is reachable', async ({ request }) => {
    const response = await request.get(OPENVSCODE_BASE_URL, {
      maxRedirects: 5,
    });
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html.length).toBeGreaterThan(200);
  });

  test('api health is reachable for vscode lane', async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL.replace(/\/$/, '')}/api/v1/health`,
    );
    expect(response.ok()).toBeTruthy();
  });
});
