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

  test('VSCode request payload streams and persists an assistant response', async ({ page, request }) => {
    const workspaceResponse = await request.post(`${API_BASE_URL}/api/v1/workspaces`, {
      data: { name: `VSCode streaming ${Date.now()}` },
    });
    expect(workspaceResponse.ok()).toBeTruthy();
    const workspaceId = (await workspaceResponse.json()).id;
    try {
      await page.goto('/folders');
      await page.evaluate(({ api, workspace }) => new Promise<void>((resolve, reject) => {
        const state = window as any;
        state.__vscodeStreamEvents = [];
        const source = new EventSource(`${api}/api/v1/streams/sse?workspace_id=${workspace}`, { withCredentials: true });
        state.__vscodeStream = source;
        source.onopen = () => resolve();
        source.onerror = () => reject(new Error('VSCode SSE connection failed'));
        for (const type of ['content_delta', 'done', 'error']) source.addEventListener(type, event => {
          state.__vscodeStreamEvents.push({ type, ...JSON.parse((event as MessageEvent).data) });
        });
      }), { api: API_BASE_URL, workspace: workspaceId });
      const response = await request.post(`${API_BASE_URL}/api/v1/chat/messages?workspace_id=${workspaceId}`, {
        data: { content: 'Explain the current workspace briefly.', model: 'mistral-small-2603',
          vscodeCodeAgent: { source: 'vscode', workspaceKey: 'ci-br81', workspaceLabel: 'CI workspace',
            promptGlobalOverride: 'Answer the user request. {{CONTEXT_BLOCK}}' } },
      });
      expect(response.ok()).toBeTruthy();
      const { sessionId, assistantMessageId } = await response.json();
      await expect.poll(() => page.evaluate(id => (window as any).__vscodeStreamEvents
        .some((event: any) => event.streamId === id && event.type === 'done'), assistantMessageId), { timeout: 20000 }).toBe(true);
      const events = await page.evaluate(id => (window as any).__vscodeStreamEvents
        .filter((event: any) => event.streamId === id), assistantMessageId);
      expect(events.some((event: any) => event.type === 'content_delta')).toBe(true);
      expect(events.some((event: any) => event.type === 'error')).toBe(false);
      const persisted = await request.get(`${API_BASE_URL}/api/v1/chat/sessions/${sessionId}/messages?workspace_id=${workspaceId}`);
      expect(persisted.ok()).toBeTruthy();
      expect(await persisted.json()).toMatchObject({ messages: expect.arrayContaining([
        expect.objectContaining({ id: assistantMessageId, role: 'assistant', content: expect.stringMatching(/\S/) }),
      ]) });
    } finally {
      await page.evaluate(() => (window as any).__vscodeStream?.close());
      await request.delete(`${API_BASE_URL}/api/v1/workspaces/${workspaceId}`);
    }
  });
});
