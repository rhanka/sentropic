import { expect, request, test } from '@playwright/test';

type WorkspaceItem = {
  id: string;
  role?: string | null;
};

const isChatMessageCreateRequest = (req: { method(): string; url(): string }) => {
  if (req.method() !== 'POST') return false;
  const pathname = new URL(req.url()).pathname;
  return /^\/api\/v1\/chat\/messages\/?$/.test(pathname);
};

const isChatSteerRequest = (req: { method(): string; url(): string }) => {
  if (req.method() !== 'POST') return false;
  const pathname = new URL(req.url()).pathname;
  return /^\/api\/v1\/chat\/messages\/[^/]+\/steer\/?$/.test(pathname);
};

test.describe.serial('chat steering core', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const DEFAULT_AUTH_STATE = './.auth/state.json';

  test('steers in-flight assistant generation through chat endpoint only', async ({
    page,
  }) => {
    const api = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: DEFAULT_AUTH_STATE,
    });

    try {
      const workspacesRes = await api.get('/api/v1/workspaces');
      expect(workspacesRes.ok()).toBeTruthy();
      const workspacesPayload = (await workspacesRes.json().catch(() => null)) as
        | { items?: WorkspaceItem[] }
        | null;
      const items = Array.isArray(workspacesPayload?.items)
        ? workspacesPayload.items
        : [];
      const writableWorkspace =
        items.find((entry) => entry.role !== 'viewer') ?? items[0];
      expect(writableWorkspace?.id).toBeTruthy();
      const workspaceId = String(writableWorkspace?.id ?? '');

      const suffix = Date.now();
      const sessionTitle = `E2E chat steer ${suffix}`;
      const initialMessage =
        "Rédige 180 lignes numérotées sur l'analyse de la maintenance prédictive ferroviaire pour Bombardier Inc., avec exemples concrets, contraintes RGPD, cybersécurité OT, budget de 1M$ et délai de 6 mois. Ne pose aucune question et n'ajoute pas de résumé.";
      const steerMessage =
        'Concentre la suite sur les 3 points les plus prioritaires.';

      const sessionsRes = await api.get(
        `/api/v1/chat/sessions?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      expect(sessionsRes.ok()).toBeTruthy();
      const sessionsPayload = (await sessionsRes
        .json()
        .catch(() => null)) as
        | { sessions?: Array<{ id?: string }> }
        | null;
      for (const session of sessionsPayload?.sessions ?? []) {
        const sessionId = String(session?.id ?? '').trim();
        if (!sessionId) continue;
        const deleteRes = await api.delete(
          `/api/v1/chat/sessions/${encodeURIComponent(sessionId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        );
        expect(deleteRes.ok()).toBeTruthy();
      }

      const createSessionRes = await api.post(
        `/api/v1/chat/sessions?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          data: {
            primaryContextType: 'folder',
            sessionTitle,
          },
        },
      );
      expect(createSessionRes.status()).toBe(200);

      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');

      const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
      await expect(chatButton).toBeVisible({ timeout: 15_000 });
      await chatButton.click();

      const composer = page.locator('[role="textbox"][aria-label="Composer"]');
      await expect(composer).toBeVisible();
      const composerEditable = page
        .locator(
          '[role="textbox"][aria-label="Composer"][contenteditable="true"]:visible, [role="textbox"][aria-label="Composer"]:visible [contenteditable="true"]:visible',
        )
        .first();
      await expect(composerEditable).toBeVisible();

      const sessionHeader = page
        .locator(
          '#chat-widget-dialog div.border-b div.min-w-0.text-xs.text-slate-500.truncate',
        )
        .first();
      await expect(sessionHeader).toContainText(sessionTitle);

      const modelSelect = page.locator('#chat-widget-dialog select').last();
      await expect(modelSelect).toBeVisible();
      const gpt52OptionValue = await modelSelect.evaluate((node) => {
        const select = node as HTMLSelectElement;
        const option = Array.from(select.options).find((item) =>
          item.text.includes('GPT-5.2'),
        );
        return option?.value ?? null;
      });
      if (gpt52OptionValue) {
        await modelSelect.selectOption(gpt52OptionValue);
      }

      await composerEditable.focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(initialMessage);
      const sendButton = page.getByTestId('chat-composer-send-button');
      await expect(sendButton).toBeEnabled({ timeout: 15_000 });
      await Promise.all([
        page.waitForRequest(
          (req) =>
            isChatMessageCreateRequest(req) &&
            (() => {
              try {
                const payload = req.postDataJSON() as { content?: string };
                return payload?.content === initialMessage;
              } catch {
                return false;
              }
            })(),
        ),
        sendButton.click(),
      ]);

      const stopButton = page.locator('button[aria-label="Stopper"]');
      await expect(stopButton).toBeVisible({ timeout: 12_000 });

      let createRequestDetectedAfterSteer = false;
      let runSteerRequestDetected = false;
      const onRequest = (req: { method(): string; url(): string }) => {
        if (isChatMessageCreateRequest(req)) {
          createRequestDetectedAfterSteer = true;
        }
        if (
          req.method() === 'POST' &&
          /\/api\/v1\/runs\/[^/]+\/steer\/?$/.test(new URL(req.url()).pathname)
        ) {
          runSteerRequestDetected = true;
        }
      };
      page.on('request', onRequest);

      await composerEditable.focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(steerMessage);
      const steerButton = page.getByTestId('chat-composer-steer-button');
      await expect(steerButton).toBeVisible();
      await expect(page.getByTestId('chat-composer-send-button')).toHaveCount(0);
      const [steerReq, steerRes] = await Promise.all([
        page.waitForRequest((req) => isChatSteerRequest(req)),
        page.waitForResponse((res) => isChatSteerRequest(res.request())),
        steerButton.click(),
      ]);
      page.off('request', onRequest);

      const steerBody = steerReq.postDataJSON() as {
        content?: string;
        message?: string;
      };
      expect(steerBody.message).toBe(steerMessage);
      expect(steerRes.status()).toBe(200);
      expect(createRequestDetectedAfterSteer).toBe(false);
      expect(runSteerRequestDetected).toBe(false);
      await expect(page.locator('#chat-widget-dialog')).toContainText(
        /Prise en compte d'un nouveau message utilisateur|Acknowledged new user steering message/i,
      );
      await expect(page.locator('#chat-widget-dialog')).toContainText(
        steerMessage,
      );
      const timelineContainer = page.locator(
        '#chat-widget-dialog .h-full.overflow-y-auto.p-3.space-y-2.slim-scroll',
      );
      await expect(timelineContainer).toBeVisible();
      const timelineShape = await timelineContainer.evaluate(
        (container, expectedSteerText) => {
          const rows = Array.from(container.children).map((row) => {
            const htmlRow = row as HTMLElement;
            const className = htmlRow.className ?? '';
            const role = className.includes('items-end')
              ? 'user'
              : className.includes('justify-start')
                ? 'assistant'
                : 'other';
            const text = (htmlRow.textContent ?? '').replace(/\s+/g, ' ').trim();
            return { role, text };
          });
          const steerIndex = rows.findIndex(
            (row) => row.role === 'user' && row.text.includes(expectedSteerText),
          );
          return {
            steerIndex,
            previousRole: steerIndex > 0 ? rows[steerIndex - 1]?.role : null,
            nextRole:
              steerIndex >= 0 && steerIndex + 1 < rows.length
                ? rows[steerIndex + 1]?.role
                : null,
          };
        },
        steerMessage,
      );
      expect(timelineShape.steerIndex).toBeGreaterThan(0);
      expect(timelineShape.previousRole).toBe('user');
      expect(timelineShape.nextRole).toBe('assistant');
    } finally {
      await api.dispose();
    }
  });
});
