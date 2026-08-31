import { test, expect, request, type Browser, type Page } from '@playwright/test';

import { withWorkspaceStorageState } from '../helpers/workspace-scope';

/**
 * End-to-end proof for the owner-reported BUG-2: "a run that COMPLETES
 * server-side leaves the chat UI frozen" (perpetual spinner / "Préparation…",
 * composer stuck in the in-flight state, no terminal assistant bubble).
 *
 * ROOT CAUSE (pre-#278): the timeline terminal status was derived only from the
 * live SSE `done`/`error` callback or the job-poll `completed` result. When BOTH
 * missed (nano no-delta runs + short-lived SSE on workspace switch / dropped
 * stream) and the run had no streamed content, `_localStatus` and `content` were
 * never set, so `derivedStatus` stayed `'processing'` forever — the freeze.
 *
 * FIX (#278, chat-ui 0.19.2): `getProjectedRunTerminalOutcome` scans the
 * PROJECTED stream events (live + history-hydrated) for a terminal `done`/`error`
 * and ORs it into `derivedStatus` in chatProjection.ts:
 *   derivedStatus = _localStatus ?? terminalOutcome ?? (content ? completed : processing)
 * So a server-completed run is never left frozen even when the live terminal
 * callbacks were missed.
 *
 * This spec proves the user-visible outcome with TWO tests:
 *   (a) deterministic baseline — a normal completed turn reaches a terminal
 *       rendered state (assistant bubble shown, composer idle, NO spinner).
 *   (b) stronger backstop exercise — the live SSE multiplex route
 *       (`/streams/sse`) is BLOCKED for the turn so the live `done` callback can
 *       never fire; the run still completes server-side (asserted via the queue
 *       job endpoint); after a reload the history-hydrated `done` event must
 *       drive the timeline terminal via the #278 projection backstop, leaving NO
 *       perpetual spinner and an idle composer.
 */
test.describe('Chat completed run leaves a terminal (non-frozen) UI', () => {
  test.describe.configure({ mode: 'serial' });

  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const QUICK_UI_TIMEOUT = 2_000;
  const AI_GENERATION_TIMEOUT = 120_000;

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

  // Composer is idle (terminal) when neither the stop button nor the steer
  // button is present — exactly the marker the chat suite uses for "not running".
  async function expectComposerIdle(page: Page, timeout = AI_GENERATION_TIMEOUT) {
    await expect
      .poll(
        async () => {
          const stopCount = await page
            .locator('#chat-widget-dialog .chat-composer-stop-button:visible')
            .count();
          const steerCount = await page.getByTestId('chat-composer-steer-button').count();
          return stopCount === 0 && steerCount === 0;
        },
        { timeout, intervals: [300, 500, 1_000] },
      )
      .toBe(true);
  }

  // The in-flight spinner: chat-ui renders a Loader2 (`animate-spin`) next to the
  // "preparing" label while the run has no content and is not terminal. A frozen
  // run keeps this spinner forever; a terminal run must not show it.
  async function expectNoPerpetualSpinner(page: Page) {
    await expect(
      page.locator('#chat-widget-dialog .animate-spin'),
    ).toHaveCount(0, { timeout: QUICK_UI_TIMEOUT });
  }

  async function waitForQueueJobSettled(page: Page, jobId: string, timeout = AI_GENERATION_TIMEOUT) {
    expect(jobId, 'POST /chat/messages must return a jobId').toBeTruthy();
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${API_BASE_URL}/api/v1/queue/jobs/${encodeURIComponent(jobId)}`,
          );
          if (!res.ok()) return `http-${res.status()}`;
          const data = await res.json().catch(() => null);
          return String((data as { status?: string } | null)?.status ?? '');
        },
        { timeout, intervals: [500, 1_000, 2_000] },
      )
      .toMatch(/^(completed|failed)$/);
  }

  type SendResult = { jobId: string; assistantMessageId: string; sessionId: string };

  // Type a message and click send, returning the run identifiers from the POST
  // response. Mirrors 03-chat.spec sendMessageAndWaitApi but without the queue
  // wait (callers decide when to settle).
  async function typeAndSend(page: Page, message: string): Promise<SendResult> {
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    const editable = composer.locator('[contenteditable="true"]:visible').first();
    await expect(editable).toBeVisible({ timeout: 5_000 });
    await editable.click();
    await page.keyboard.type(message);
    await expect(editable).toContainText(message, { timeout: 5_000 });

    const matchesChatMessages = (url: string) => {
      try {
        return new URL(url).pathname.endsWith('/chat/messages');
      } catch {
        return false;
      }
    };
    const sendBtn = page.getByTestId('chat-composer-send-button');
    await expect(sendBtn).toBeEnabled({ timeout: 5_000 });
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && matchesChatMessages(r.url()),
        { timeout: 30_000 },
      ),
      sendBtn.click(),
    ]);
    expect(res.status()).toBeLessThan(400);
    expect(new URL(res.url()).pathname).toBe('/api/v1/chat/messages');
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      jobId: String(data?.jobId ?? ''),
      assistantMessageId: String(data?.assistantMessageId ?? ''),
      sessionId: String(data?.sessionId ?? ''),
    };
  }

  // (a) Deterministic baseline: a normal completed turn must leave the UI
  // terminal — assistant bubble rendered, composer idle, no perpetual spinner.
  test('a completed turn renders a terminal assistant message and idle composer', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const userApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const workspaceRes = await userApi.post('/api/v1/workspaces', {
      data: { name: `Freeze Terminal Baseline ${Date.now()}` },
    });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspaceId = String((await workspaceRes.json().catch(() => null))?.id ?? '');
    expect(workspaceId).toBeTruthy();

    const { context, page } = await createScopedPage(browser, workspaceId);
    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await openChat(page);

      const run = await typeAndSend(page, 'Reply with a short one-line greeting.');
      await waitForQueueJobSettled(page, run.jobId);

      // The run completed server-side — the UI MUST reach terminal:
      // 1. an assistant bubble is rendered (content visible),
      const assistantBubble = page
        .locator('#chat-widget-dialog div.flex.justify-start div.rounded.bg-white.border.border-slate-200')
        .last();
      await expect(assistantBubble).toBeVisible({ timeout: AI_GENERATION_TIMEOUT });
      await expect(assistantBubble).not.toBeEmpty({ timeout: AI_GENERATION_TIMEOUT });

      // 2. the composer returns to idle (no stop/steer in-flight controls),
      await expectComposerIdle(page);
      // 3. no perpetual "Préparation…" spinner remains.
      await expectNoPerpetualSpinner(page);

      console.log('[freeze-terminal.spec] BUG-2 baseline — completed run reached terminal UI (bubble shown, composer idle, no spinner).');
    } finally {
      await context.close();
      await userApi.dispose();
    }
  });

  // (b) Stronger backstop exercise: block the live SSE multiplex so the live
  // `done` callback never fires. The run still completes server-side; after a
  // reload the history-hydrated `done` event must drive terminal via the #278
  // projection backstop (getProjectedRunTerminalOutcome) — no frozen spinner.
  test('a server-completed run reaches terminal after the live SSE was blocked (projection backstop)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const userApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const workspaceRes = await userApi.post('/api/v1/workspaces', {
      data: { name: `Freeze Terminal SSE-Drop ${Date.now()}` },
    });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspaceId = String((await workspaceRes.json().catch(() => null))?.id ?? '');
    expect(workspaceId).toBeTruthy();

    const { context, page } = await createScopedPage(browser, workspaceId);

    // Block the live SSE multiplex route for the whole turn so the client can
    // NEVER receive the live terminal `done` event. The server-side job runs
    // independently of any SSE consumer, so it still completes and persists.
    let sseBlocked = 0;
    await context.route('**/streams/sse**', async (route) => {
      sseBlocked += 1;
      await route.abort();
    });

    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await openChat(page);

      const run = await typeAndSend(page, 'Reply with a short one-line greeting.');
      expect(run.sessionId).toBeTruthy();

      // The run completes server-side even though the client got no live SSE.
      await waitForQueueJobSettled(page, run.jobId);
      expect(sseBlocked, 'live SSE route should have been hit and aborted').toBeGreaterThan(0);

      // Lift the SSE block, then reload + reopen so the session history ndjson
      // hydrates the projected stream events (including the persisted terminal
      // `done`). Pre-#278 this is where the UI stayed frozen on a no-content run;
      // post-#278 the projection backstop OR's `terminalOutcome` into the status.
      await context.unroute('**/streams/sse**');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openChat(page);

      // The hydrated run MUST be terminal: composer idle and no perpetual spinner.
      await expectComposerIdle(page);
      await expectNoPerpetualSpinner(page);

      console.log(`[freeze-terminal.spec] BUG-2 backstop — SSE aborted ${sseBlocked}x; server-completed run reached terminal UI after reload (no frozen spinner).`);
    } finally {
      await context.close();
      await userApi.dispose();
    }
  });
});
