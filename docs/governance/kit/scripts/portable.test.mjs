import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlinePortable, assertPortable } from './portable.mjs';

test('should inline styles and entry scripts when producing an offline page', () => {
  const html = inlinePortable('<link rel="stylesheet" href="/assets/a.css"><script type="module" src="/assets/a.js"></script>',
    name => name.endsWith('.css') ? 'body{color:red}' : 'document.title="Ready"');
  assert.match(html, /<style/);
  assert.match(html, /document.title/);
});
test('should reject imports of assets when an entry is inlined', () => {
  for (const code of ['import("./assets/scene.js")', "import ( '/assets/scene.js')", 'import(`./assets/scene.js`)',
    'import x from "./assets/shared.js"', 'import "./assets/shared.js"',
    'import("./sibling-chunk.js")', 'import(chunkPath)']) {
    assert.throws(() => inlinePortable('<script type="module" src="/assets/a.js"></script>', () => code), /external dist asset/);
  }
  assert.throws(() => assertPortable('<style>body{background:url(./assets/a.png)}</style>'), /external dist asset/);
});
