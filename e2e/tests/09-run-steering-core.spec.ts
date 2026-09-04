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

test.describe('chat steering core after the Flow cutover', () => {
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
      const suffix = Date.now();
      const workspaceRes = await api.post('/api/v1/workspaces', {
        data: { name: `E2E chat steering ${suffix}` },
      });
      expect(workspaceRes.ok()).toBeTruthy();
      const workspaceId = String((await workspaceRes.json().catch(() => null))?.id ?? '');
      expect(workspaceId).toBeTruthy();
      const sessionTitle = `E2E chat steer ${suffix}`;
      const initialMessage =
        "Rédige 180 lignes numérotées sur l'analyse de la maintenance prédictive ferroviaire pour Bombardier Inc., avec exemples concrets, contraintes RGPD, cybersécurité OT, budget de 1M$ et délai de 6 mois. Ne pose aucune question et n'ajoute pas de résumé.";
      const steerMessage =
        'Concentre la suite sur les 3 points les plus prioritaires.';

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

      await page.addInitScript((id) => localStorage.setItem('workspaceScopeId', id), workspaceId);
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
          '#chat-widget-dialog [data-chat-sessions-heading]',
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
          // Timeline rows live inside a hydration-swap wrapper
          // (<div class:invisible={historyHydrationSwapPending}>, added by
          // ddaeebec2 "refactor: split app chat panel wrapper"); the staging
          // sibling is pointer-events-none. Anchor the row scan on that
          // wrapper — assertion semantics below are unchanged.
          const rowsHost =
            container.querySelector(':scope > div:not(.pointer-events-none)') ??
            container;
          const rows = Array.from(rowsHost.children).map((row) => {
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

  test('configures an agent through the root-remapped public path', async () => {
    const api = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: DEFAULT_AUTH_STATE,
    });
    let workspaceId = '';
    let createdId = '';

    try {
      const workspacesRes = await api.get('/api/v1/workspaces');
      expect(workspacesRes.ok()).toBeTruthy();
      const payload = (await workspacesRes.json()) as { items?: WorkspaceItem[] };
      const items = Array.isArray(payload.items) ? payload.items : [];
      const writableWorkspace = items.find((entry) => entry.role !== 'viewer') ?? items[0];
      workspaceId = String(writableWorkspace?.id ?? '');
      expect(workspaceId).toBeTruthy();

      const key = `e2e-agent-${Date.now()}`;
      const path = `/api/v1/agent-config?workspace_id=${encodeURIComponent(workspaceId)}`;
      const putRes = await api.put(path, {
        data: {
          items: [{
            key,
            name: 'E2E agent configuration',
            config: { model: 'gpt-4.1-nano' },
            sourceLevel: 'user',
          }],
        },
      });
      expect(putRes.status()).toBe(200);
      const putPayload = (await putRes.json()) as {
        items?: Array<{ id?: string; key?: string; config?: unknown }>;
      };
      const created = putPayload.items?.find((item) => item.key === key);
      createdId = String(created?.id ?? '');
      expect(created).toMatchObject({ key, config: { model: 'gpt-4.1-nano' } });
      expect(createdId).toBeTruthy();

      const listRes = await api.get(path);
      expect(listRes.status()).toBe(200);
      const listPayload = (await listRes.json()) as { items?: Array<{ id?: string }> };
      expect(listPayload.items?.some((item) => item.id === createdId)).toBe(true);

      const doubled = await api.get(
        `/api/v1/agents/agent-config?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      expect(doubled.status()).toBe(404);
    } finally {
      if (workspaceId && createdId) {
        const deleted = await api.delete(
          `/api/v1/agent-config/${encodeURIComponent(createdId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        );
        expect(deleted.status()).toBe(204);
      }
      await api.dispose();
    }
  });
});
