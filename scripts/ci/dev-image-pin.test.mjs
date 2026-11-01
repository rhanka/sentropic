import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The canonical production artifact is pinned through API_IMAGE_REF (Makefile
// line 80 reads it from the recorded receipt). Dev-stack commands must clear
// that pin: with the pin set, `image:` resolves to the production digest,
// which ships without npm, so prepare-node-workspace fails with
// `sh: npm: not found` and `up --build` boots production content as dev.
const makefile = readFileSync(new URL('../../Makefile', import.meta.url), 'utf8');

const devApiRecipes = [
  'prepare-node-workspace',
  'up-api:',
  'up-api-test:',
];

for (const recipe of devApiRecipes) {
  test(`${recipe} clears the production image pin`, () => {
    const lines = makefile.split('\n');
    const header = lines.findIndex((line) => line.startsWith(recipe));
    assert.notEqual(header, -1, `recipe ${recipe} exists`);
    const owned = [];
    for (let i = header + 1; i < lines.length && lines[i].startsWith('\t'); i++) {
      owned.push(lines[i]);
    }
    const composeLines = owned.filter((line) => line.includes('docker-compose.dev.yml'));
    assert.ok(composeLines.length > 0, `${recipe} issues dev-stack compose commands`);
    for (const line of composeLines) {
      assert.match(line, /API_IMAGE_REF=\s/, `${recipe}: ${line.trim()} must clear API_IMAGE_REF`);
    }
  });
}
