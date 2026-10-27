import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectGovernanceScene } from '../src/governance-projection.js';
import { collapseGovernanceScene } from '../src/governance-collapse.js';
import { configureTranslations, t } from '../src/i18n.js';
import { prepareDossierScenes, sliceTranslations } from './dossier-input.mjs';
const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));

test('should project only supplied routes and fail when a required route is absent', () => {
  const scene = { id: 'central', edges: [], projectionRoutes: { overview: [{ id: 'selected' }] } };
  assert.equal(projectGovernanceScene(scene).edges[0].id, 'selected');
  assert.throws(() => projectGovernanceScene({ id: 'central' }), /Missing prepared route/);
  assert.throws(() => projectGovernanceScene(scene, { needId: 'unrelated' }), /Missing prepared route/);
  const small = { id: 'small' };
  assert.equal(projectGovernanceScene(small), small);
});
test('should preserve all twelve fold states using dossier-only prepared geometry', () => {
  const scenes = prepareDossierScenes(read('../fixtures/artifact-weight/harness-scenes.json'));
  let states = 0;
  for (const scene of Object.values(scenes)) {
    for (let mask = 0; mask < 2 ** scene.groups.length; mask++) {
      const ids = scene.groups.filter((_, i) => mask & (1 << i)).map(g => g.id);
      assert.deepEqual(collapseGovernanceScene(scene, ids).edges, collapseGovernanceScene(scene, ids, false).edges);
      states++;
    }
  }
  assert.equal(states, 12);
});
test('should preserve exact and trimmed translation lookups without unrelated prose', () => {
  const dictionary = { 'Bonjour': 'Hello', 'Déplier': 'Expand', 'Replier': 'Collapse', 'unrelated': 'excess' };
  const sliced = sliceTranslations(dictionary, { title: ' Bonjour ' }, ["t(open ? 'Déplier' : 'Replier')"]);
  assert.deepEqual(Object.keys(sliced), ['Bonjour', 'Déplier', 'Replier']);
  configureTranslations(sliced);
  assert.equal(t(' Bonjour ', 'en'), ' Hello ');
  assert.equal(t('Déplier', 'en'), 'Expand');
});
