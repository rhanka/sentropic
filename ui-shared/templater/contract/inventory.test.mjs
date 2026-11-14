import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, sourcePath } from './inventory.mjs';

const require = createRequire(import.meta.url);
const postcss = require('postcss');
const directory = new URL('.', import.meta.url);
const rows = readdirSync(directory).filter(name => /^print-inventory-\d+\.json$/.test(name))
  .sort().flatMap(name => JSON.parse(readFileSync(new URL(name, directory))));
const css = readFileSync(sourcePath, 'utf8');

test('inventory covers every selector line and every media/page prelude independently', () => {
  const ast = postcss.parse(css);
  const expected = [];
  let selectors = 0;
  ast.walkRules(rule => {
    rule.selector.split('\n').forEach((line, offset) => {
      if (line.trim()) { expected.push(rule.source.start.line + offset); selectors++; }
    });
  });
  ast.walkAtRules(rule => expected.push(rule.source.start.line));
  assert.equal(selectors, 433);
  assert.equal(rows.length, 441);
  assert.deepEqual(rows.map(row => row.line), expected.sort((a, b) => a - b));
  assert.equal(new Set(rows.map(row => row.line)).size, 441);
  for (const row of rows) {
    assert.ok(css.split('\n')[row.line - 1].includes(row.selector));
    assert.ok(row.target.length > 0);
    assert.match(row.hook, /^(?:\[data-print-|#app|@page|@media)/);
    assert.doesNotMatch(row.hook, /\.(?:prose|rounded|grid|space-y|border|text-)/);
  }
  assert.deepEqual(rows, generate(css), 'checked-in inventory must match reproducible generator');
});

test('template layouts, compact content, annex and cover have semantic print targets', () => {
  for (const token of ['layout-head', 'layout-main', 'layout-bottom', 'layout-quad',
    'column-a', 'column-b', 'report-introduction', 'report-analyse']) {
    assert.ok(rows.some(row => row.hook.includes(`data-print-layout~="${token}"`)), token);
  }
  for (const part of ['compact-content', 'annex-item', 'cover']) {
    assert.ok(rows.some(row => row.hook.includes(`data-print-part="${part}"`)), part);
  }
});
