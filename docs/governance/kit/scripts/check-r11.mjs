import { chromium } from '/app/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { dossier, portableName } from './portable-path.mjs';

const out = '/r11-shots';
const files = { before: '../governance-r10-portable.html', after: `dist/${portableName}` };
const report = { counting: 'Intl.Segmenter word tokens; eight slides plus each selectable need once; all details, including closed ones; excludes SVGs, dialogs and historical feedback/remark annexes; repeated page chrome counted on every slide.', matrix: [] };
const words = (text, lang) => [...new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)].filter(s => s.isWordLike).length;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  for (const width of [1440, 1920, 390]) for (const language of ['fr', 'en']) {
    const pair = { width, language };
    const diagrams = {};
    for (const stage of ['before', 'after']) {
      mkdirSync(`${out}/${stage}`, { recursive: true });
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1080 }, offline: true, isMobile: width === 390, hasTouch: width === 390 });
      const page = await context.newPage(), errors = [], requests = [];
      page.setDefaultTimeout(1800);
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
      await page.goto('file://' + process.cwd() + '/' + files[stage]);
      await page.locator('.architecture-figure svg').first().waitFor();
      if (language === 'en') await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      const row = { sha256: createHash('sha256').update(readFileSync(files[stage])).digest('hex'), slides: [], routes: [], diagrams: {} };
      row.title = await page.locator('h1').evaluate(h => ({ text: h.textContent, pixels: parseFloat(getComputedStyle(h).fontSize), lines: h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight) }));
      if (stage === 'after') assert((await page.locator('.dossier-header').textContent()).includes(dossier.revision), 'Badge uses the source revision');
      const prefix = `${out}/${stage}/${stage === 'after' ? 'r11' : 'r10'}-${width}-${language}`;
      await page.screenshot({ path: `${prefix}-page.png`, animations: 'disabled' });
      const figure = page.locator('.architecture-figure').first();
      diagrams[stage] = {};
      async function capture(name, host) {
        await page.waitForFunction(() => document.querySelector('.architecture-figure').getAttribute('aria-busy') === 'false');
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const measured = await host.locator('svg.architecture-svg').evaluate(svg => ({
          markup: svg.outerHTML,
          scale: svg.getScreenCTM().a,
          width: svg.getBoundingClientRect().width,
          height: svg.getBoundingClientRect().height,
          paints: [...svg.querySelectorAll('text, rect, path')].map(el => {
            const s = getComputedStyle(el);
            return [s.fill, s.stroke, s.fontSize, s.fontFamily];
          }),
        }));
        diagrams[stage][name] = measured;
        row.diagrams[name] = { ...measured, markup: createHash('sha256').update(measured.markup).digest('hex'), paints: undefined };
        await host.screenshot({ path: `${prefix}-${name}.png`, animations: 'disabled' });
      }
      await capture('inline-collapsed', figure.locator('.diagram-scroll'));
      await figure.getByRole('button', { name: language === 'fr' ? 'Tout déplier' : 'Expand all', exact: true }).click();
      await capture('inline-expanded', figure.locator('.diagram-scroll'));
      await figure.getByRole('button', { name: language === 'fr' ? /^Agrandir :/ : /^Enlarge:/ }).click();
      const dialog = page.locator('dialog[open]');
      await capture('viewer-expanded', dialog.locator('.viewer-viewport'));
      await dialog.getByRole('button', { name: language === 'fr' ? 'Tout replier' : 'Collapse all', exact: true }).click();
      await capture('viewer-collapsed', dialog.locator('.viewer-viewport'));
      await dialog.locator('[data-viewer-close]').click();
      const prose = el => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('svg, style, script, dialog, [data-owner-feedback-annex], .remarks-section').forEach(e => e.remove());
        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT), texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode.textContent);
        return texts.join(' ');
      };
      for (const need of await page.locator('[data-need-id]').evaluateAll(es => es.map(e => e.dataset.needId).filter(id => id !== 'all'))) {
        await page.locator(`[data-need-id="${need}"]`).click();
        row.routes.push({ need, words: words(await page.locator('[data-active-route-card]').evaluate(prose), language) });
      }
      await page.locator('[data-need-id="all"]').click();
      for (let slide = 0; slide < 8; slide++) {
        row.slides.push({ slide, words: words(await page.locator('main.dossier').evaluate(prose), language) });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow: ${stage}/${width}/${language}/${slide}`);
        if (stage === 'after' && slide >= 5) {
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: `${prefix}-G${slide - 4}.png`, fullPage: true, animations: 'disabled' });
        }
        if (slide < 7) await page.locator('.dossier-nav').getByRole('button', { name: language === 'fr' ? 'Suivante' : 'Next', exact: true }).click();
      }
      row.words = [...row.slides, ...row.routes].reduce((n, item) => n + item.words, 0);
      assert.deepEqual(errors, [], 'Browser errors');
      assert.deepEqual(requests, [], 'External requests');
      pair[stage] = row;
      await context.close();
    }
    for (const name of Object.keys(diagrams.before)) {
      assert.deepEqual(diagrams.after[name], diagrams.before[name], `Unchanged diagram: ${width}/${language}/${name}`);
    }
    assert(pair.after.title.pixels <= pair.before.title.pixels * .7, 'Title at least 30% smaller');
    if (width >= 1440) assert(pair.after.title.lines <= 2.01, 'Title fits in two lines');
    assert(pair.after.words <= pair.before.words / 2, 'Non-diagram prose at least halved');
    report.matrix.push(pair);
    writeFileSync(`${out}/acceptance.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ width, language, words: [pair.before.words, pair.after.words], title: [pair.before.title, pair.after.title], diagrams: 'identical' }));
  }
  report.status = 'passed';
} finally {
  writeFileSync(`${out}/acceptance.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
