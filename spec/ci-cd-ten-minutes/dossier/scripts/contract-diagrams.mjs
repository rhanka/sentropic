// Adapted from the retained focus-ci-efficiency-kit diagram adapter. Geometry,
// docking and routing remain owned by the same private DS generator.
export const caseOptions = ['unknown', 'api', 'ui', 'mixed', 'shared-asset', 'tooling-lock', 'compatible-fix', 'additive', 'breaking-upgrade', 'fresh-release'];
export const eventOptions = ['pull_request', 'push', 'workflow_dispatch', 'daily'];
export const groups = ['critical-path', 'all', 'build', 'static', 'validation', 'runtime', 'security', 'release'];
export const steps = [
  ['Capacity', /changes|ci-gate|ci-capacity/], ['Preparation', /typecheck|lint/],
  ['Images', /build-|security-container/], ['Parallel DAG', /test-|smoke-|security/],
  ['Candidates', /candidate|validate-cluster|validate-llm|manifest/],
  ['Deterministic journeys', /test-|smoke-|daily/], ['Delivery', /publish-|deploy-|release/],
  ['Consumers', /consumer|validate-|test-api/], ['Proof', /ci-gate|ci-capacity/],
];
const groupPatterns = { build: /^build-/, static: /typecheck|lint/, validation: /^validate-|candidate|consumer/,
  runtime: /^test-|smoke-|e2e/, security: /^security-/, release: /^publish-|deploy-|release/ };
export const heat = seconds => seconds === null ? 'missing' : seconds <= 15 ? 'short' : seconds <= 60 ? 'medium' : seconds <= 180 ? 'long' : 'slow';
export function selectRuns(report, phase, changeCase, event) {
  return report.runs.filter(run => run.phase === phase && (run.case ?? 'unknown') === changeCase
    && run.event === event);
}
export function sceneFor(run, group = 'critical-path', step = 9) {
  if (!run) return { id: 'ci', nodes: [], edges: [] };
  const critical = new Set(Object.values(run.criticalPaths).flatMap(path => path.jobs.map(job => job.name.split(' (')[0])));
  const byName = new Map();
  for (const job of run.jobs.filter(job => job.conclusion !== 'skipped')) {
    const name = job.name.split(' (')[0];
    const members = byName.get(name) ?? []; members.push(job); byName.set(name, members);
  }
  const names = [...byName.keys()].filter(name => group === 'all' || group === 'critical-path' && critical.has(name)
    || groupPatterns[group]?.test(name));
  const nodes = names.map(name => {
    const members = byName.get(name);
    const seconds = members.every(job => job.seconds !== null) ? Math.max(...members.map(job => job.seconds)) : null;
    return { id: name, position: { x: 0, y: 0 }, data: { label: `${name}\n${seconds === null ? 'to measure' : `${seconds}s`}`, seconds, members,
      optimization: steps.filter(([, pattern]) => pattern.test(name)).map(([title]) => title).join(', ') || 'Retain required gate; measure before optimizing',
      modified: steps[step - 1][1].test(name), heat: heat(seconds) } };
  });
  // Actual critical paths carry exact dependency edges. Retain those edges in
  // all views; additional selected groups do not invent new relationships.
  const edges = [];
  for (const path of Object.values(run.criticalPaths)) for (let i = 1; i < path.jobs.length; i++) {
    const source = path.jobs[i - 1].name.split(' (')[0], target = path.jobs[i].name.split(' (')[0];
    if (names.includes(source) && names.includes(target) && !edges.some(edge => edge.id === `${source}:${target}`)) edges.push({ id: `${source}:${target}`, source, target });
  }
  return { id: 'ci', nodes, edges };
}

export async function layoutScene(scene, targetWidth, fontFamily) {
  const [{ defaultProfileRegistry: registry }, { layoutDocument, relationRoute }] = await Promise.all([
    import('@sentropic/diagram-core'), import('@sentropic/diagram-canvas')]);
  if (!scene.nodes.length) return { nodes: [], edges: [] };
  const context = document.createElement('canvas').getContext('2d');
  const measureText = text => { context.font = `14px ${fontFamily}`; const lines = text.split('\n');
    return { width: Math.max(...lines.map(line => context.measureText(line).width)), height: lines.length * 19 }; };
  const entities = Object.fromEntries(scene.nodes.map((node, i) => [`entity:n${i}`, { id: `entity:n${i}`, profile: 'generic@1', type: 'node',
    attributes: { name: { kind: 'text', value: node.data.label } } }]));
  const ref = id => `entity:n${scene.nodes.findIndex(node => node.id === id)}`;
  const relations = Object.fromEntries(scene.edges.map((edge, i) => [`relation:r${i}`, { id: `relation:r${i}`, profile: 'generic@1', type: 'link',
    endpoints: [{ role: 'source', target: ref(edge.source) }, { role: 'target', target: ref(edge.target) }], attributes: {} }]));
  const result = layoutDocument({ documentId: 'document:ci', schemaVersion: { major: 1, minor: 1 }, revision: 0,
    profileRefs: ['generic@1'], typeDefinitions: {}, entities, relations, ports: {}, resources: {}, extensions: [] },
  { registry, targetWidth, measureText, metrics: { nodeMinWidth: 280, nodeMinHeight: 80, nodePaddingX: 14, nodePaddingY: 10, rankGap: 70, nodeGap: 28 } });
  if (result.status === 'refused') throw Error('DS diagram layout refused');
  return { nodes: scene.nodes.map((node, i) => {
    const box = Object.values(result.view.entityOccurrences).find(item => item.entity === `entity:n${i}`).geometry;
    return { ...node, position: { x: box.x, y: box.y }, width: box.width, height: box.height,
      class: `heat-${node.data.heat}${node.data.modified ? ' modified' : ''}` };
  }), edges: scene.edges.map((edge, i) => {
    const occurrence = Object.values(result.view.relationOccurrences).find(item => item.relation === `relation:r${i}`);
    return { ...edge, type: 'ds-route', data: { waypoints: relationRoute(result.view, occurrence.id) } };
  }) };
}
