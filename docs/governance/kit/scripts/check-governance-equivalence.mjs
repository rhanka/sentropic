import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.cwd(), directory = resolve('.cache/artifact-weight');
const reference = resolve(directory, 'main-source/docs/governance/kit');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
async function snapshot(source, current) {
  const load = name => import(pathToFileURL(resolve(source, 'src', name)));
  const { projectGovernanceScene: project } = await load('governance-projection.js');
  const { collapseGovernanceScene: collapse } = await load('governance-collapse.js');
  const { renderSceneSvg: render } = await load('architecture-svg.js');
  const bind = current ? (await load('governance-input.js')).bindGovernanceScene : scene => scene;
  const presentation = readJson(resolve(source, 'src/presentation-scenes.json'));
  const routes = readJson(resolve(source, 'src/governance-routes.json'));
  const rows = [];
  const capture = (name, scene, highlight = null) => {
    const svg = render(scene.id, scene, highlight, scene.groups.length > 0);
    const graph = { groups: scene.groups, nodes: scene.nodes, edges: scene.edges };
    rows.push({ name, graphSha256: hash(JSON.stringify(canonical(graph))), svgSha256: hash(svg), svgBytes: Buffer.byteLength(svg) });
  };
  for (const language of ['fr', 'en']) {
    const needs = presentation.navigation.needs;
    for (const [collection, scenes] of Object.entries(presentation[language])) for (const [id, raw] of Object.entries(scenes)) {
      const scene = id === 'central' ? bind(raw) : raw;
      const all = scene.groups.map(group => group.id);
      const highlights = [null, ...needs.map(need => ({ needId: need.id, ...need.highlight }))];
      for (const [i, highlight] of highlights.entries()) {
        const projected = project(scene, highlight);
        for (const [label, ids] of [['expanded', []], ['collapsed', all]]) {
          capture(`${language}/${collection}/${id}/need-${i}/${label}`, collapse(projected, ids), highlight);
        }
      }
      if (id === 'central') {
        const projected = project(scene);
        for (const mask of Object.keys(routes[language].plans)) {
          const ids = all.filter((_, i) => Number(mask) & (1 << i));
          capture(`${language}/${id}/plan/${mask}`, collapse(projected, ids));
        }
      } else {
        for (let mask = 0; mask < 2 ** all.length; mask++) {
          capture(`${language}/${id}/fold/${mask}`, collapse(scene, all.filter((_, i) => mask & (1 << i))));
        }
      }
      for (const [i, fold] of (id === 'central' ? routes[language].folded : scene.preparedFolds ?? []).entries()) {
        const [geometry] = JSON.parse(fold.signature);
        const byId = new Map([...scene.groups, ...scene.nodes].map(node => [node.id, node]));
        const visible = geometry.map(([key, parentId, x, y, width, height, headerTextHeight, collapsed]) =>
          ({ ...byId.get(key), parentId, position: { x, y }, width, height, headerTextHeight, collapsed }));
        capture(`${language}/${id}/prepared/${i}`, { ...scene, projectionKey: 'prepared-receipt',
          groups: visible.filter(node => !node.data), nodes: visible.filter(node => node.data), edges: fold.edges });
      }
    }
  }
  return rows;
}
const before = await snapshot(reference, false), after = await snapshot(root, true);
assert(before.length > 0, 'The governance comparison must exercise figures');
assert.deepEqual(after, before, 'Governance figures or routes differ from the pinned main renderer');
const receipt = { referenceCommit: readFileSync(resolve(directory, 'main-source/commit.txt'), 'utf8').trim(),
  codeCommit: process.env.ARTIFACT_COMMIT, comparison: 'Exact SVG bytes and canonical groups/nodes/edges SHA-256; both renderers executed',
  languages: ['fr', 'en'], cases: after.length, referenceSha256: hash(JSON.stringify(before)),
  currentSha256: hash(JSON.stringify(after)), results: after };
writeFileSync(resolve(directory, 'governance-equivalence.json'), JSON.stringify(receipt, null, 2));
console.log(`PASS governance equivalence with main ${receipt.referenceCommit}: ${after.length} figures/routes`);
