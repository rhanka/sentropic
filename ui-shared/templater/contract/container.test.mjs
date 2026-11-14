import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { activate, cardFor, dispatchFileMenu } = require('/tmp/templater-contract/container.js');
const { colorTones, fieldCardPresentation, printHooks } = require('/tmp/templater-contract/presentation.js');

test('card and action activation preserve href precedence and async completion', async () => {
  const calls = [];
  await activate({ href: '/folders', onClick: () => calls.push('wrong') }, async href => calls.push(href));
  await activate({ onClick: async () => calls.push('callback') }, () => calls.push('wrong'));
  activate({}, () => calls.push('wrong'));
  assert.deepEqual(calls, ['/folders', 'callback']);
});

test('all file-menu callbacks fire once and hidden actions never dispatch', async () => {
  for (const [action, suffix] of Object.entries({ new: 'New', import: 'Import', export: 'Export', print: 'Print', delete: 'Delete' })) {
    let count = 0;
    const menu = { [`show${suffix}`]: true, [`on${suffix}`]: async () => { count++; } };
    await dispatchFileMenu(menu, action);
    menu[`show${suffix}`] = false;
    await dispatchFileMenu(menu, action);
    assert.equal(count, 1);
  }
});

test('cards retain the reference fallback and custom callback mapping', () => {
  assert.deepEqual(cardFor({}, { name: 'Name', title: 'Title', description: 'Description' }), {
    title: 'Name', subtitle: 'Description',
  });
  assert.equal(cardFor({}, {}).title, 'Untitled');
  const item = { name: 'Workspace' };
  const card = { title: 'Custom', icon: 'home', iconTone: 'category2', onClick() {} };
  assert.equal(cardFor({ cardRenderer: received => { assert.equal(received, item); return card; } }, item), card);
});

test('all six colours map to DS tones; non-accent variants stay neutral', () => {
  assert.equal(Object.keys(colorTones).length, 6);
  for (const [color, tone] of Object.entries(colorTones)) {
    assert.deepEqual(fieldCardPresentation(color), { variant: 'accent', tone });
    for (const variant of ['plain', 'bordered']) {
      assert.deepEqual(fieldCardPresentation(color, variant), { variant, tone: 'neutral' });
    }
  }
  assert.equal(fieldCardPresentation('unknown').tone, 'neutral');
});

test('print tokens and every break, visibility and page attribute survive unchanged', () => {
  assert.deepEqual(printHooks({ printClass: 'column-a colspan-2-print', printGridClass: 'layout-quad',
    pageBreakBefore: 'always', pageBreakAfter: 'avoid', pageBreakInside: 'avoid',
    printOnly: true, screenOnly: true, pageContext: 'annex' }), {
    'data-print-layout': 'column-a colspan-2-print',
    'data-print-break-before': 'always', 'data-print-break-after': 'avoid',
    'data-print-break-inside': 'avoid', 'data-print-page': 'annex',
    'data-print-only': 'true', 'data-print-hidden': 'true',
  });
  assert.deepEqual(printHooks({ printClass: 'custom-one custom-two' }), { 'data-print-layout': 'custom-one custom-two' });
  assert.deepEqual(printHooks({ printGridClass: 'layout-quad' }, true), { 'data-print-layout': 'layout-quad' });
  assert.deepEqual(printHooks({ printOnly: false, screenOnly: false }), {});
});
