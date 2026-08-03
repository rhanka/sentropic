import { test, expect, request } from '@playwright/test';

import { withWorkspaceStorageState } from '../helpers/workspace-scope';

// AI-independent: history + checkpoint list/restore are mocked at the network
// boundary so the spec deterministically proves the timeline-rewind UX and a
// post-restore send (POST /chat/messages) without any model dependency.
test.setTimeout(120_000);

test.describe('Chat checkpoint restore', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';

  const chatButtonSelector = 'button[aria-controls="chat-widget-dialog"]';
  const composerSelector = '[role="textbox"][aria-label="Composer"]';

  // The session has 2 user/assistant exchanges. A checkpoint is anchored at the
  // FIRST user message (anchorSequence=1). The SECOND assistant message (seq 4)
  // carries a mutating tool call (organization_update) in its stream events, so
  // `hasCheckpointMutationDelta` is true and the per-message restore affordance
  // renders on the first user message.
  const SESSION_ID = `cp-restore-${Date.now()}`;
  const CHECKPOINT_ID = `cp-${Date.now()}`;
  const USER1_ID = `${SESSION_ID}:user1`;
  const ASSISTANT1_ID = `${SESSION_ID}:assistant1`;
  const USER2_ID = `${SESSION_ID}:user2`;
  const ASSISTANT2_ID = `${SESSION_ID}:assistant2`;
  const USER1_TEXT = `CP-USER-ONE-${Date.now()}`;
  const USER2_TEXT = `CP-USER-TWO-${Date.now()}`;
  const ASSISTANT1_TEXT = 'CP-ASSISTANT-ONE';
  const ASSISTANT2_TEXT = 'CP-ASSISTANT-TWO (mutated organization)';

  const messageLine = (
    id: string,
    role: 'user' | 'assistant',
    content: string,
    sequence: number,
  ) =>
    JSON.stringify({
      type: 'timeline_item',
      item: {
        kind: 'message',
        key: `${id}:message`,
        message: {
          id,
          sessionId: SESSION_ID,
          role,
          content,
          sequence,
          ...(role === 'assistant'
            ? { model: 'gpt-4.1-nano', _localStatus: 'completed' }
            : {}),
          createdAt: '2026-03-11T00:00:00.000Z',
        },
      },
    });

  // Assistant segment for the SECOND assistant message: a single assistant-segment
  // whose stream events include a tool_call_start for organization_update. This is
  // what makes the checkpoint show a rollback delta (mutating tool after anchor).
  const assistantSegmentLine = () =>
    JSON.stringify({
      type: 'timeline_item',
      item: {
        kind: 'assistant-segment',
        key: `${ASSISTANT2_ID}:seg0`,
        streamId: ASSISTANT2_ID,
        isLastAssistantSegment: true,
        isTerminal: true,
        message: {
          id: ASSISTANT2_ID,
          sessionId: SESSION_ID,
          role: 'assistant',
          content: ASSISTANT2_TEXT,
          sequence: 4,
          model: 'gpt-4.1-nano',
          _localStatus: 'completed',
          _streamId: ASSISTANT2_ID,
        },
        segment: {
          id: `${ASSISTANT2_ID}:seg0`,
          kind: 'assistant',
          content: ASSISTANT2_TEXT,
          steerCountBefore: 0,
          events: [
            {
              eventType: 'tool_call_start',
              sequence: 1,
              data: {
                tool_call_id: 'call_org_update_1',
                name: 'organization_update',
                args: '{"organizationId":"org-xyz","updates":[{"field":"technologies","value":"Kubernetes"}]}',
              },
            },
          ],
        },
      },
    });

  const fullHistoryBody = () =>
    [
      JSON.stringify({
        type: 'session_meta',
        sessionId: SESSION_ID,
        title: USER1_TEXT,
        todoRuntime: null,
        documents: [],
        checkpoints: [
          {
            id: CHECKPOINT_ID,
            title: 'Checkpoint at first turn',
            anchorMessageId: USER1_ID,
            anchorSequence: 1,
            messageCount: 1,
            createdAt: '2026-03-11T00:00:00.500Z',
          },
        ],
      }),
      messageLine(USER1_ID, 'user', USER1_TEXT, 1),
      messageLine(ASSISTANT1_ID, 'assistant', ASSISTANT1_TEXT, 2),
      messageLine(USER2_ID, 'user', USER2_TEXT, 3),
      assistantSegmentLine(),
    ].join('\n');

  // After restore the session is rewound to the checkpoint anchor: only the first
  // exchange remains (later user/assistant messages are gone).
  const rewoundHistoryBody = () =>
    [
      JSON.stringify({
        type: 'session_meta',
        sessionId: SESSION_ID,
        title: USER1_TEXT,
        todoRuntime: null,
        documents: [],
        checkpoints: [
          {
            id: CHECKPOINT_ID,
            title: 'Checkpoint at first turn',
            anchorMessageId: USER1_ID,
            anchorSequence: 1,
            messageCount: 1,
            createdAt: '2026-03-11T00:00:00.500Z',
          },
        ],
      }),
      messageLine(USER1_ID, 'user', USER1_TEXT, 1),
      messageLine(ASSISTANT1_ID, 'assistant', ASSISTANT1_TEXT, 2),
    ].join('\n');

  test('restores an earlier checkpoint, rewinds the timeline, and allows a new send', async ({
    browser,
  }) => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    // A real workspace to scope storage state (the chat history itself is mocked).
    const workspaceName = `Checkpoint Restore ${Date.now()}`;
    const workspaceRes = await userAApi.post('/api/v1/workspaces', {
      data: { name: workspaceName },
    });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspace = await workspaceRes.json().catch(() => null);
    const workspaceId = String(workspace?.id ?? '');
    expect(workspaceId).toBeTruthy();
    await userAApi.dispose();

    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    let restoreCalled = false;

    try {
      // Mock the session list so our fixture session appears in the picker.
      await page.route(/\/api\/v1\/chat\/sessions(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [
              {
                id: SESSION_ID,
                title: USER1_TEXT,
                createdAt: '2026-03-11T00:00:00.000Z',
                updatedAt: '2026-03-11T00:00:02.000Z',
              },
            ],
          }),
        });
      });

      // Mock the history endpoint: full timeline before restore, rewound after.
      await page.route(
        new RegExp(`/api/v1/chat/sessions/${SESSION_ID}/history(?:\\?.*)?$`),
        async (route) => {
          const body = restoreCalled ? rewoundHistoryBody() : fullHistoryBody();
          await route.fulfill({
            status: 200,
            contentType: 'application/x-ndjson',
            body: `${body}\n`,
          });
        },
      );

      // Mock the checkpoint list (fetched by loadCheckpoints / fetchCheckpoints).
      await page.route(
        new RegExp(`/api/v1/chat/sessions/${SESSION_ID}/checkpoints(?:\\?.*)?$`),
        async (route) => {
          if (route.request().method() === 'POST') {
            // createCheckpoint — not expected here, ack it.
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ id: CHECKPOINT_ID }),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              checkpoints: [
                {
                  id: CHECKPOINT_ID,
                  title: 'Checkpoint at first turn',
                  anchorMessageId: USER1_ID,
                  anchorSequence: 1,
                  messageCount: 1,
                  createdAt: '2026-03-11T00:00:00.500Z',
                },
              ],
            }),
          });
        },
      );

      // Mock the restore endpoint — flips the history to the rewound timeline.
      await page.route(
        new RegExp(
          `/api/v1/chat/sessions/${SESSION_ID}/checkpoints/${CHECKPOINT_ID}/restore(?:\\?.*)?$`,
        ),
        async (route) => {
          restoreCalled = true;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              sessionId: SESSION_ID,
              checkpointId: CHECKPOINT_ID,
              restoredToSequence: 1,
            }),
          });
        },
      );

      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');

      const chatButton = page.locator(chatButtonSelector);
      await expect(chatButton).toBeVisible({ timeout: 10_000 });
      await chatButton.click();
      await expect(page.locator('#chat-widget-dialog')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator(composerSelector)).toBeVisible({ timeout: 10_000 });

      // Open the session from the agents list. Session switching now goes
      // through the list (the old chooser popover was removed in pager hosts):
      // from a conversation, the Back control returns to the list where each
      // session is a listbox option carrying its title (here USER1_TEXT).
      // Only the active view is rendered, so these selectors can target the
      // dialog directly without matching an off-screen inactive row.
      const activePage = '#chat-widget-dialog';
      const backToList = page
        .locator(
          `${activePage} button[aria-label="Retour aux conversations"], ${activePage} button[aria-label="Back to conversations"]`,
        )
        .first();
      if (await backToList.isVisible().catch(() => false)) {
        await backToList.click();
      }
      const sessionItem = page
        .locator(`${activePage} [role="option"]`)
        .filter({ hasText: USER1_TEXT })
        .first();
      await expect(sessionItem).toBeVisible({ timeout: 10_000 });
      await sessionItem.click();

      // Full timeline is present: both assistant replies are visible.
      const dialog = page.locator('#chat-widget-dialog');
      await expect(dialog).toContainText(ASSISTANT1_TEXT, { timeout: 20_000 });
      await expect(dialog).toContainText(USER2_TEXT, { timeout: 10_000 });

      // The restore affordance renders on the first user message (checkpoint has
      // a mutation delta from the organization_update tool call after the anchor).
      const restoreButton = page
        .locator(
          '#chat-widget-dialog button[aria-label="Restaurer depuis ce point"], #chat-widget-dialog button[aria-label="Restore from this point"]',
        )
        .first();
      await expect(restoreButton).toBeVisible({ timeout: 10_000 });
      await restoreButton.click();

      // Confirm the restore in the prompt dialog.
      const confirmButton = page
        .locator('#chat-widget-dialog button.chat-checkpoint-choice')
        .first();
      await expect(confirmButton).toBeVisible({ timeout: 5_000 });

      const [restoreResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/checkpoints/${CHECKPOINT_ID}/restore`) &&
            res.request().method() === 'POST',
          { timeout: 15_000 },
        ),
        confirmButton.click(),
      ]);
      expect(restoreResponse.status()).toBe(200);

      // Timeline rewinds: the second exchange is gone, the first remains.
      await expect(dialog).not.toContainText(USER2_TEXT, { timeout: 15_000 });
      await expect(dialog).not.toContainText('mutated organization', { timeout: 5_000 });
      await expect(dialog).toContainText(ASSISTANT1_TEXT, { timeout: 10_000 });

      // A new send works post-restore: POST /chat/messages fires (AI reply not required).
      let sendObserved = false;
      await page.route(/\/api\/v1\/chat\/messages(?:\?.*)?$/, async (route) => {
        if (route.request().method() === 'POST') {
          sendObserved = true;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              sessionId: SESSION_ID,
              jobId: 'job-postrestore',
              streamId: 'stream-postrestore',
              messageId: 'msg-postrestore',
              assistantMessageId: 'amsg-postrestore',
            }),
          });
          return;
        }
        await route.continue();
      });

      const composer = page.locator(composerSelector);
      const editable = composer.locator('[contenteditable="true"]');
      await editable.click();
      await page.keyboard.type('Post-restore message');
      const [postRestoreReq] = await Promise.all([
        page.waitForRequest(
          (req) =>
            req.method() === 'POST' && req.url().includes('/api/v1/chat/messages'),
          { timeout: 15_000 },
        ),
        page.keyboard.press('Enter'),
      ]);
      expect(postRestoreReq.url()).toContain('/api/v1/chat/messages');
      expect(sendObserved).toBeTruthy();

      expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});
