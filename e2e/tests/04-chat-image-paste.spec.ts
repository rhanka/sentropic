import { test, expect, request, type Browser, type Page } from '@playwright/test';

import { withWorkspaceStorageState } from '../helpers/workspace-scope';

// Regression spec: pasting an image into the chat composer then sending MUST
// issue POST /api/v1/chat/messages and persist the user message bubble.
// Captures pageerror events so a client-side exception in the send path is
// surfaced verbatim instead of a silent UI freeze.
test.describe('Chat composer image paste send', () => {
  test.describe.configure({ mode: 'serial' });

  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';

  // 1x1 red PNG
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  async function createScopedPage(browser: Browser, workspaceId: string) {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });
    const page = await context.newPage();
    return { context, page };
  }

  async function openChat(page: Page) {
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();
    await expect(page.locator('#chat-widget-dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[role="textbox"][aria-label="Composer"]')).toBeVisible({
      timeout: 10_000,
    });
  }

  async function pasteImageIntoComposer(page: Page, fileName: string) {
    await page.evaluate(
      ({ b64, name }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], name, { type: 'image/png' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        const composer = document.querySelector(
          '[role="textbox"][aria-label="Composer"]',
        );
        if (!composer) throw new Error('composer textbox not found');
        const event = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        });
        composer.dispatchEvent(event);
      },
      { b64: PNG_BASE64, name: fileName },
    );
  }

  test('pasting an image then sending issues POST /chat/messages and persists the bubble', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const userApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const workspaceName = `Image Paste Send ${Date.now()}`;
    const workspaceRes = await userApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspaceJson = await workspaceRes.json().catch(() => null);
    const workspaceId = String(workspaceJson?.id ?? '');
    expect(workspaceId).toBeTruthy();

    const { context, page } = await createScopedPage(browser, workspaceId);

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ''}`);
    });

    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await openChat(page);

      const fileName = `pasted-image-${Date.now()}.png`;
      await pasteImageIntoComposer(page, fileName);

      // Attachment chip appears with the pasted file name.
      const attachmentBand = page.getByTestId('chat-composer-attachment-band');
      await expect(attachmentBand).toBeVisible({ timeout: 2_000 });
      await expect(attachmentBand).toContainText(fileName, { timeout: 2_000 });
      // Thumbnail rendered from the blob preview URL.
      await expect(attachmentBand.locator('img')).toBeVisible({ timeout: 2_000 });
      // Upload completes: chip shows the ready-state mime type label.
      await expect(attachmentBand).toContainText('image/png', { timeout: 10_000 });

      // Send button becomes enabled (ready attachment, no text needed).
      const sendBtn = page.getByTestId('chat-composer-send-button');
      await expect(sendBtn).toBeEnabled({ timeout: 2_000 });

      // The POST /api/v1/chat/messages request MUST fire on click.
      const messagesRequestPromise = page.waitForRequest(
        (req) => {
          if (req.method() !== 'POST') return false;
          try {
            return new URL(req.url()).pathname.endsWith('/chat/messages');
          } catch {
            return false;
          }
        },
        { timeout: 10_000 },
      );

      await sendBtn.click();

      let messagesRequest: Awaited<typeof messagesRequestPromise> | null = null;
      try {
        messagesRequest = await messagesRequestPromise;
      } catch {
        // fallthrough — assert below with pageerror context
      }

      if (pageErrors.length > 0) {
        console.log('[image-paste.spec] pageerror events captured:');
        for (const err of pageErrors) console.log(err);
      }
      expect(
        messagesRequest,
        `POST /chat/messages did not fire. pageerrors:\n${pageErrors.join('\n---\n')}`,
      ).not.toBeNull();

      const postBody = messagesRequest!.postDataJSON() as {
        attachments?: Array<{ kind: string; documentId: string }>;
      };
      expect(Array.isArray(postBody.attachments)).toBeTruthy();
      expect(postBody.attachments!.length).toBe(1);
      expect(postBody.attachments![0].kind).toBe('image');
      expect(postBody.attachments![0].documentId).toBeTruthy();

      // The user message bubble persists with the image attachment thumbnail.
      const userAttachmentImage = page.locator(
        `#chat-widget-dialog img[alt="${fileName}"]`,
      );
      await expect(userAttachmentImage.last()).toBeVisible({ timeout: 10_000 });

      // Composer band is cleared after a successful send.
      await expect(attachmentBand).toHaveCount(0, { timeout: 5_000 });

      // No uncaught client-side exceptions during the whole flow.
      expect(pageErrors, pageErrors.join('\n---\n')).toEqual([]);
    } finally {
      await context.close();
      await userApi.dispose();
    }
  });

  // Regression: a RESTORED session whose last assistant run is terminal in
  // history (error event, null content) must not lock the composer in steer
  // mode. Pre-fix, the restored message stayed implicitly "processing"
  // forever: the send button never came back, so pasting an image then
  // clicking the primary action NEVER issued POST /chat/messages.
  test('image paste send still works in a restored session after a failed run', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const userApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const workspaceName = `Image Paste Restore ${Date.now()}`;
    const workspaceRes = await userApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspaceJson = await workspaceRes.json().catch(() => null);
    const workspaceId = String(workspaceJson?.id ?? '');
    expect(workspaceId).toBeTruthy();

    const { context, page } = await createScopedPage(browser, workspaceId);

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ''}`);
    });

    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await openChat(page);

      // Seed the session with a plain text message. In the e2e stack the AI
      // job fails fast (no provider key) leaving an assistant row with null
      // content + an 'error' stream event — the restored-session trap.
      const composer = page.locator('[role="textbox"][aria-label="Composer"]');
      const editable = composer.locator('[contenteditable="true"]:visible').first();
      await expect(editable).toBeVisible({ timeout: 5_000 });
      await editable.click();
      await page.keyboard.type('Restored session regression seed.');
      await expect(editable).toContainText('Restored session', { timeout: 5_000 });
      const seedPost = page.waitForRequest(
        (req) => req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/chat/messages'),
        { timeout: 10_000 },
      );
      await page.getByTestId('chat-composer-send-button').click();
      await seedPost;

      // Wait until the failed run reaches a terminal state (composer idle).
      await expect
        .poll(
          async () => {
            const stopCount = await page
              .locator('#chat-widget-dialog .chat-composer-stop-button:visible')
              .count();
            const steerCount = await page.getByTestId('chat-composer-steer-button').count();
            return stopCount === 0 && steerCount === 0;
          },
          { timeout: 90_000, intervals: [500, 1_000] },
        )
        .toBe(true);

      // Restore: reload the page and reopen the chat, then wait for the
      // session history to hydrate (the seeded user message is visible).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openChat(page);
      await expect(page.locator('#chat-widget-dialog')).toContainText(
        'Restored session regression seed.',
        { timeout: 10_000 },
      );

      // Paste an image into the restored session.
      const fileName = `restored-paste-${Date.now()}.png`;
      await pasteImageIntoComposer(page, fileName);
      const attachmentBand = page.getByTestId('chat-composer-attachment-band');
      await expect(attachmentBand).toBeVisible({ timeout: 2_000 });
      await expect(attachmentBand).toContainText('image/png', { timeout: 10_000 });

      // Core regression assertion: the SEND button must be available and
      // enabled (pre-fix the composer stayed locked on the steer action).
      const sendBtn = page.getByTestId('chat-composer-send-button');
      await expect(sendBtn).toBeVisible({ timeout: 2_000 });
      await expect(sendBtn).toBeEnabled({ timeout: 2_000 });

      const messagesRequestPromise = page.waitForRequest(
        (req) => {
          if (req.method() !== 'POST') return false;
          try {
            return new URL(req.url()).pathname.endsWith('/chat/messages');
          } catch {
            return false;
          }
        },
        { timeout: 10_000 },
      );

      await sendBtn.click();

      let messagesRequest: Awaited<typeof messagesRequestPromise> | null = null;
      try {
        messagesRequest = await messagesRequestPromise;
      } catch {
        // fallthrough — assert below with pageerror context
      }

      if (pageErrors.length > 0) {
        console.log('[image-paste.spec] pageerror events captured (restored):');
        for (const err of pageErrors) console.log(err);
      }
      expect(
        messagesRequest,
        `POST /chat/messages did not fire in restored session. pageerrors:\n${pageErrors.join('\n---\n')}`,
      ).not.toBeNull();

      const postBody = messagesRequest!.postDataJSON() as {
        attachments?: Array<{ kind: string; documentId: string }>;
      };
      expect(postBody.attachments?.length).toBe(1);
      expect(postBody.attachments?.[0].kind).toBe('image');

      // The user message bubble persists with the attachment thumbnail.
      const userAttachmentImage = page.locator(
        `#chat-widget-dialog img[alt="${fileName}"]`,
      );
      await expect(userAttachmentImage.last()).toBeVisible({ timeout: 10_000 });

      expect(pageErrors, pageErrors.join('\n---\n')).toEqual([]);
    } finally {
      await context.close();
      await userApi.dispose();
    }
  });
});
