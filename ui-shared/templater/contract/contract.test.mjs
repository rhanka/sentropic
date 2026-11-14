import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const ts = require('typescript');
const schema = JSON.parse(readFileSync(new URL('descriptor.schema.json', import.meta.url)));
const validate = new Ajv({ allErrors: true }).compile(schema);
// Evaluate only the pure seed functions, never the API service or its DB imports.
const source = readFileSync('api/src/services/view-template-service.ts', 'utf8');
const start = source.indexOf('function getDefaultViewTemplates(');
assert.ok(start > 0, 'seed function boundary exists');
const js = ts.transpileModule(source.slice(start), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const seeds = runInNewContext(`${js}; ['ai-priorities', 'opportunity', 'code'].flatMap(getDefaultViewTemplates)`);
const records = JSON.parse(JSON.stringify(seeds));
const shapes = [...new Map(records.map(row => [JSON.stringify(row.descriptor), row])).values()];

test('all 17 actual seed records and seven distinct descriptor shapes validate', () => {
  assert.equal(records.length, 17);
  assert.equal(shapes.length, 7);
  for (const row of records) assert.ok(validate(row.descriptor), JSON.stringify(validate.errors));
});

test('schema rejects seeded field, row, print and recursive-loop mutations', () => {
  const initiative = records.find(row => row.objectType === 'initiative').descriptor;
  const mutations = [
    value => { value.tabs[0].rows[0].fields[0].type = 'unknown-field'; },
    value => { value.tabs[0].rows[0].fields[0].key = 42; },
    value => { value.tabs[0].rows[0].columns = 0; },
    value => { value.tabs[0].rows[1].main.fields[0].span = -1; },
    value => { value.tabs[0].rows[0].pageBreakBefore = 'unbounded'; },
    value => { value.tabs[0].rows[1].fields = []; },
    value => { delete value.tabs[0].rows[1].sidebar; },
    value => { value.tabs[0].rows[0].fields[0].printOnly = 'yes'; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(initiative); mutate(value);
    assert.equal(validate(value), false, JSON.stringify(value));
  }
  const dashboard = structuredClone(records.find(row => row.objectType === 'dashboard').descriptor);
  const loop = dashboard.tabs[0].rows.at(-1).fields[0];
  delete loop.templateRef;
  assert.equal(validate(dashboard), false);
});

test('eight field kinds, slots and opaque custom presentation data remain valid', () => {
  for (const type of schema.definitions.field.properties.type.enum) {
    const field = { key: 'nested.custom', type, collection: 'items', templateRef: 'custom',
      printClass: 'custom-layout custom-width', color: 'custom-color', futureMetadata: 42 };
    assert.ok(validate({ tabs: [{ key: 'custom', rows: [{ fields: [field] }] }] }));
  }
});
