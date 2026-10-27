// Browser proof for the slimmed r5 portable. Same assertions as
// scripts/check-harness-browser.mjs (title, cards, folds, viewer, touch,
// questions, tables, JSON download, offline, no errors), plus per-section
// screenshots. Env: PORTABLE (default .cache/artifact-weight/typical/dist/dossier-portable.html),
// OUT (default .cache/artifact-weight/typical).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire('/tmp/artifact-probe/package.json');
const { chromium } = require('playwright');
const portable = process.env.PORTABLE || '.cache/artifact-weight/typical/dist/dossier-portable.html';
const output = path.resolve(process.env.OUT || '.cache/artifact-weight/typical');
fs.mkdirSync(output + '/shots', { recursive: true });
const source = JSON.parse(fs.readFileSync("fixtures/artifact-weight/dossier.json", "utf8"));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], downloadsPath: process.env.TMPDIR });
const results = [];
try {
  for (const config of [{ width: 1920, height: 1080, colorScheme: 'light' }, { width: 1440, height: 1000, colorScheme: 'dark' }, { width: 390, height: 844, colorScheme: 'light', isMobile: true, hasTouch: true }, { width: 390, height: 844, colorScheme: 'dark', isMobile: true, hasTouch: true }]) {
    const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, ...config, offline: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [], network = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('request', (r) => { if (/^https?:/.test(r.url())) network.push(r.url()); });
    await page.goto(`file://${path.resolve(portable)}`);
    await page.locator('.architecture-figure').waitFor(); await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.title(), source.title);
    assert.equal(await page.locator('h1').innerText(), source.title);
    assert((await page.locator('h1').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) <= 20);
    const check = async (label) => {
      await page.waitForTimeout(100);
      assert.equal(await page.locator('[data-card-overflow]').count(), 0, `${label} card overflow`);
      assert((await page.evaluate(() => document.documentElement.scrollWidth)) <= config.width + 1, `${label} page overflow`);
      assert.deepEqual(errors, [], `${label} console exceptions`);
    };
    await check('initial');
    assert.equal(await page.locator('[data-collapsed="false"]').count(), 0);
    await page.screenshot({ path: `${output}/shots/${config.width}-${config.colorScheme}-overview.png`, fullPage: true });
    let folds = 0;
    for (const label of ['Qualification', 'Rôles']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await check(label);
      const ids = await page.locator('.diagram-scroll [data-group]').evaluateAll((es) => es.map((e) => e.dataset.group));
      for (let mask = 0; mask < 2 ** ids.length; mask++) {
        await page.getByRole('button', { name: 'Tout replier', exact: true }).isEnabled().then(async (enabled) => { if (enabled) await page.getByRole('button', { name: 'Tout replier', exact: true }).click(); });
        for (let i = 0; i < ids.length; i++) if (mask & (1 << i)) await page.locator(`[data-frame-control="${ids[i]}"]`).click();
        await check(`${label} fold ${mask}`); folds++;
      }
    }
    await page.getByRole('button', { name: 'Qualification', exact: true }).click();
    await page.getByRole('button', { name: 'Tout déplier', exact: true }).click(); await check('expanded');
    await page.screenshot({ path: `${output}/shots/${config.width}-${config.colorScheme}-expanded.png`, fullPage: true });
    await page.getByRole('button', { name: 'Agrandir : Deux parcours indépendants', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    if (config.hasTouch) {
      const box = await page.locator('.viewer-viewport').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      const session = await context.newCDPSession(page);
      const before = await page.locator('.viewer-transform').evaluate((e) => e.style.transform);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 28, y }, { x: x + 28, y }] });
      for (const distance of [40, 55, 75, 100]) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - distance, y }, { x: x + distance, y }] });
        await page.waitForTimeout(30);
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.notEqual(await page.locator('.viewer-transform').evaluate((e) => e.style.transform), before, 'Two-finger zoom changes vector transform');
      assert.equal(await page.evaluate(() => visualViewport.scale), 1, 'Pinch does not scale the page');
      await page.screenshot({ path: `${output}/shots/${config.width}-${config.colorScheme}-pinch.png` });
      await session.detach();
    }
    await page.getByRole('button', { name: 'Agrandir le diagramme', exact: true }).click();
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    for (const [index, q] of source.sections.filter((s) => s.kind === 'question').entries()) {
      await page.getByRole('navigation', { name: 'Parcours du dossier' }).getByRole('button').nth(index + 1).click();
      assert.equal(await page.locator('#question-title').innerText(), q.question);
      assert.equal(await page.locator('.harness-options .st-tile').count(), 3);
      await page.locator('.harness-options .st-tile').first().click();
      assert((await page.locator('.local-selection').innerText()).includes('Aucune décision enregistrée'));
      await check(`question ${index + 1}`);
      if (index === 0) await page.screenshot({ path: `${output}/shots/${config.width}-${config.colorScheme}-question.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'Inventaire · 24 + 8', exact: true }).click();
    assert.equal(await page.locator('table').nth(0).locator('tbody tr').count(), 8);
    assert.equal(await page.locator('table').nth(1).locator('tbody tr').count(), 24);
    await check('inventory');
    await page.screenshot({ path: `${output}/shots/${config.width}-${config.colorScheme}-inventory.png`, fullPage: true });
    await page.getByRole('button', { name: 'Sources et corrections', exact: true }).click();
    assert.equal(await page.locator('.owner-round').count(), 2);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger le dossier JSON', exact: true }).click();
    const download = await downloadPromise; const file = await download.path();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), source);
    await page.reload(); await page.locator('.architecture-figure').waitFor();
    await page.getByRole('navigation', { name: 'Parcours du dossier' }).getByRole('button').nth(1).click();
    assert((await page.locator('.local-selection').innerText()).startsWith('Aucune option choisie'));
    assert.deepEqual(network, []); assert.deepEqual(errors, []);
    results.push({ viewport: `${config.width}×${config.height}`, theme: config.colorScheme, offline: true, foldStates: folds, titleBand: true, questions: 2, options: 6, inventory: 24, gaps: 8, originalJsonDownload: true, touchPinch: !!config.hasTouch, selectionClearedOnReload: true, overflow: 0, errors, network });
    console.log(`PASS browser ${config.width} ${config.colorScheme}: ${folds} folds, choices, tables, downloads, offline.`);
    await context.close();
  }
} finally { await browser.close(); fs.writeFileSync(`${output}/browser.json`, `${JSON.stringify({ results }, null, 2)}\n`); }
