import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { caseOptions, eventOptions, groups, sceneFor, steps } from '../scripts/contract-diagrams.mjs';
import report from '../node_modules/.ci-report.json';
const artifact = pathToFileURL(path.resolve('dist/ci-cd-sentropic-portable.html')).href;

for (const phase of ['before', 'after']) for (const changeCase of caseOptions) {
  test(`portable controls preserve case/event/step selections: ${phase}/${changeCase}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(artifact);
    const panel = page.locator('.command-panel');
    await expect(panel).toBeVisible();
    await panel.getByLabel('Evidence', { exact: true }).selectOption(phase);
    await panel.getByLabel('Case', { exact: true }).selectOption(changeCase);
    for (const event of eventOptions) {
      await panel.getByLabel('Event', { exact: true }).selectOption(event);
      for (const [index, [title]] of steps.entries()) {
        const button = panel.getByRole('button', { name: `${index + 1}. ${title}`, exact: true });
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(panel.getByLabel('Case', { exact: true })).toHaveValue(changeCase);
        await expect(panel.getByLabel('Event', { exact: true })).toHaveValue(event);
      }
    }
    expect(errors).toEqual([]);
  });
}

test('portable graph preserves viewport, job/step provenance and keyboard controls', async ({ page }) => {
  await page.goto(artifact);
  const node = page.locator('.svelte-flow__node[data-id="changes"]');
  await expect(node).toBeVisible();
  const viewport = page.locator('.svelte-flow__viewport');
  const initial = await viewport.getAttribute('style');
  await page.getByRole('button', { name: '3. Images', exact: true }).click();
  await expect(viewport).toHaveAttribute('style', initial!);
  await node.click();
  const detail = page.getByLabel('Selected job detail');
  await expect(detail).toBeVisible();
  await detail.locator('summary').first().click();
  await expect(detail.getByRole('link', { name: /Run 42300540682, attempt 1, job/ })).toHaveAttribute('href', /actions\/runs\/42300540682\/job\//);
  await expect(detail.locator('li').first()).toContainText('Set up job');
  const selector = page.getByLabel('Evidence', { exact: true });
  await selector.focus(); await selector.press('ArrowDown');
  await expect(selector).toHaveValue('after');
  await expect(page.locator('[aria-live="polite"]')).toContainText('to measure');
  await selector.press('ArrowUp');
  await expect(selector).toHaveValue('before');
  await expect(viewport).toHaveAttribute('style', initial!);
});

test('portable artifact keeps the canvas controls within wide and narrow viewports', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(artifact);
    const panel = page.locator('.command-panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/dossier-${width}.png`, fullPage: true });
  }
});

test('group controls render every measured matrix and never fabricate unselected release jobs', async ({ page }) => {
  await page.goto(artifact);
  const run = report.runs.find(row => row.runId === 42300540682)!;
  for (const group of groups) {
    await page.getByLabel('Groups', { exact: true }).selectOption(group);
    await expect(page.locator('.svelte-flow__node')).toHaveCount(sceneFor(run, group).nodes.length);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});
