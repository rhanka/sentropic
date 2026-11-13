import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Counts include each block's opening and closing tags.
export const sizes = { S: [60, 70, 20], M: [220, 280, 100], L: [1100, 1400, 500] };
export function fixture(size) {
  const [script, template, style] = sizes[size];
  return [
    '<script setup lang="ts" vapor>',
    "import { ref } from 'vue';",
    "import { Button } from '@sentropic/design-system-vue';",
    'const count = ref(0);',
    ...Array.from({ length: script - 6 }, (_, i) => `const value${i}: number = ${i};`),
    'const color = "red";',
    '</script>',
    '<template>',
    '  <Button @click="count++">{{ count }}</Button>',
    ...Array.from({ length: template - 3 }, (_, i) => `  <p class="item-${i}">{{ value${i % (script - 6)} }}</p>`),
    '</template>',
    '<style scoped>',
    '.root { color: v-bind(color); }',
    ...Array.from({ length: style - 3 }, (_, i) => `.item-${i} { padding: ${i % 8}px; }`),
    '</style>',
  ].join('\n');
}

export const edits = {
  style: source => source.replace('padding: 0px', 'padding: 1px'),
  template: source => source.replace('class="item-0"', 'class="edited"'),
  whole: source => source.replace('const count = ref(0)', 'const count = ref(1)'),
  cssBinding: source => source.replace('v-bind(color)', 'v-bind(count)'),
  scoped: source => source.replace('<style scoped>', '<style>'),
  slotted: source => source.replace('.item-0 {', ':slotted(.item-0) {'),
  importedBinding: source => source.replace('<Button @click="count++">{{ count }}</Button>', '<button>{{ count }}</button>'),
};

if (process.argv.includes('--write')) {
  const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  for (const size of Object.keys(sizes)) {
    const source = fixture(size);
    const expected = sizes[size].reduce((a, b) => a + b);
    if (source.split('\n').length !== expected) throw Error(`fixture ${size} line mismatch`);
    // JSON stores the exact SFC bytes without splitting one fixture over commits.
    writeFileSync(`${dir}/F-LIVE-${size}.json`, `${JSON.stringify({ source })}\n`);
  }
}
