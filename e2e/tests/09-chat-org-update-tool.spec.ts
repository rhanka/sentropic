import { test, expect, request } from '@playwright/test';

import { withWorkspaceStorageState } from '../helpers/workspace-scope';

/**
 * Targeted proof for the owner-reported BUG-1: "the model failed to update an
 * organization's technologies field". This spec seeds an organization, asks the
 * chat (DEFAULT e2e model) to update its `technologies` field, waits for the run
 * to complete, and asserts via API that the field actually changed.
 *
 * ROOT CAUSE (pre-#277): the DEFAULT model (gpt-4.1-nano) reproducibly calls
 * organization_update with a `patch` object (or an `updates` OBJECT) instead of
 * the declared required `updates:[{field,value}]` ARRAY. The old executor required
 * an array and rejected with "updates is required"; the model did not self-correct.
 *
 * FIX (#277, merged): tool-service `normalizeFieldUpdates` coerces the
 * model-emitted `updates` object / `patch` object into the canonical
 * `[{field,value}]` array BEFORE the validation guard. So the exact mis-call the
 * weak model makes now applies the update instead of erroring. This spec is the
 * end-to-end proof: it drives the REAL model and asserts the persisted field
 * actually changes. UN-FIXMED for #277 — the executor-level tolerance is what
 * makes the field change deterministic regardless of which shape the model emits.
 */
test.setTimeout(8 * 60_000);

test.describe('Chat organization_update tool', () => {
  test.describe.configure({ mode: 'serial', retries: 0 });

  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const TARGET_VALUE = 'Kubernetes, Terraform, GitOps';

  const readOrgTechnologies = async (
    api: import('@playwright/test').APIRequestContext,
    orgId: string,
  ): Promise<string> => {
    const res = await api.get(`/api/v1/organizations/${orgId}`);
    if (!res.ok()) return '';
    const body = await res.json().catch(() => null);
    const data = (body?.data ?? {}) as Record<string, unknown>;
    const fromData = typeof data.technologies === 'string' ? data.technologies : '';
    const fromTop = typeof body?.technologies === 'string' ? body.technologies : '';
    return (fromData || fromTop || '').trim();
  };

  test('updates the organization technologies field on request (default model)', async ({
    browser,
  }) => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    const workspaceName = `Org Update Tool ${Date.now()}`;
    const workspaceRes = await userAApi.post('/api/v1/workspaces', {
      data: { name: workspaceName },
    });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspace = await workspaceRes.json().catch(() => null);
    const workspaceId = String(workspace?.id ?? '');
    expect(workspaceId).toBeTruthy();

    const orgName = `Org Update Target ${Date.now()}`;
    const orgRes = await userAApi.post(
      `/api/v1/organizations?workspace_id=${workspaceId}`,
      {
        // organizationInput is a FLAT schema (name, industry, technologies, ...).
        data: {
          name: orgName,
          industry: 'Software',
          technologies: 'Legacy mainframe',
        },
      },
    );
    expect(orgRes.ok()).toBeTruthy();
    const org = await orgRes.json().catch(() => null);
    const orgId = String(org?.id ?? '');
    expect(orgId).toBeTruthy();

    // Scope a workspace-bound API context for reading the field back.
    const scopedApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });

    const before = await readOrgTechnologies(scopedApi, orgId);
    expect(before).toBe('Legacy mainframe');

    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });
    const page = await context.newPage();

    let toolCallObserved = false;
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/streams/events') || url.includes('/chat/messages')) {
        response
          .text()
          .then((t) => {
            if (t.includes('organization_update')) toolCallObserved = true;
          })
          .catch(() => {});
      }
    });

    try {
      await page.goto(`/organizations/${orgId}`);
      await page.waitForURL(/\/organizations\/[^/?#]+$/, { timeout: 15_000 });
      await page.waitForLoadState('domcontentloaded');
      await page
        .waitForResponse(
          (res) =>
            res.url().includes(`/api/v1/organizations/${orgId}`) &&
            res.status() === 200,
          { timeout: 10_000 },
        )
        .catch(() => {});

      const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
      await expect(chatButton).toBeVisible({ timeout: 10_000 });
      await chatButton.click();
      const composer = page.locator('[role="textbox"][aria-label="Composer"]');
      await expect(composer).toBeVisible({ timeout: 10_000 });

      const editable = composer.locator('[contenteditable="true"]');
      await editable.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(
        `Update the technologies field of this organization to exactly: ${TARGET_VALUE}`,
      );

      const [sendResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.request().method() === 'POST' &&
            res.url().includes('/api/v1/chat/messages'),
          { timeout: 30_000 },
        ),
        page.keyboard.press('Enter'),
      ]);
      expect(sendResponse.status()).toBeLessThan(400);

      // Wait for the run to complete: an assistant reply renders.
      const assistantResponse = page.locator('div.flex.justify-start').last();
      await expect(assistantResponse).toBeVisible({ timeout: 120_000 });

      // Poll the persisted field until it reflects the update (SSE + DB write).
      const start = Date.now();
      let after = '';
      while (Date.now() - start < 120_000) {
        after = await readOrgTechnologies(scopedApi, orgId);
        if (after !== before && after.toLowerCase().includes('kubernetes')) break;
        await page.waitForTimeout(2000);
      }

      // Concrete proof line for the report (reporter=list surfaces console.log).
      console.log(
        `[org-update.spec] BUG-1 proof — technologies before=${JSON.stringify(before)} after=${JSON.stringify(after)} toolCallObserved=${toolCallObserved}`,
      );

      // Primary assertion: the field changed and carries the requested value.
      expect(after).not.toBe(before);
      expect(after.toLowerCase()).toContain('kubernetes');
      // Secondary signal (non-fatal): the organization_update tool call was seen.
      expect(toolCallObserved || after.toLowerCase().includes('kubernetes')).toBeTruthy();
    } finally {
      await context.close();
      await scopedApi.dispose();
      await userAApi.dispose();
    }
  });
});
