import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire('/tmp/artifact-probe/package.json')('playwright');
const directory = resolve('.cache/artifact-weight/governance');
const artifact = directory + '/dist/dossier-portable.html';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const results = [];
try {
  for (const language of ['fr', 'en']) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 }, colorScheme });
    const page = await context.newPage(), errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await page.goto('file://' + artifact);
    await page.locator('.architecture-figure svg').first().waitFor();
    if (language === 'en') await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('html').getAttribute('lang'), language);
    const figure = page.locator('.architecture-figure').first();
    assert.equal(await figure.locator('.diagram-scroll [data-node]').count(), 0);
    assert.equal(await figure.locator('.diagram-scroll [data-group]').count(), 6);
    assert.equal(await figure.locator('.diagram-scroll [data-edge-label]').count(), 10);
    await figure.getByRole('button', { name: language === 'fr' ? 'Tout déplier' : 'Expand all', exact: true }).click();
    assert(await figure.locator('.diagram-scroll [data-node]').count() > 0);
    await figure.getByRole('button', { name: language === 'fr' ? 'Tout replier' : 'Collapse all', exact: true }).click();
    await page.locator('[data-need-id]').nth(1).click();
    assert(await figure.locator('.diagram-scroll [data-edge]').count() > 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    results.push({ language, colorScheme, offline: true, initialSummaryFlows: 10, expandedAndCollapsed: true, selectedNeed: true });
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(directory + '/browser.json', JSON.stringify({
    portableSha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'), results,
  }, null, 2));
}
console.log(`PASS full governance explicit inputs: ${results.length} language/theme configurations`);
