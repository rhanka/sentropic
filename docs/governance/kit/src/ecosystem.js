import { CURRENT_SCHEMA_VERSION, DIAGRAM_PRESENTATION_CONTRACT_PIN, m3ProfileRegistry, shippedExecutorBindings } from '@sentropic/diagram-core';

// Verified against .tmp/agent-loop-v2/existing-inventory.md (2026-11-12).
// Tuple: id, repository, package, kind, capability, icon.
export const inventory = [
  ['chat-core', 'sentropic', '@sentropic/chat-core', 'lib', 'Chat contracts', 'api'],
  ['chat-server', 'sentropic', '@sentropic/chat-server', 'lib', 'Chat server composition', 'server'],
  ['chat-ui', 'sentropic', '@sentropic/chat-ui', 'lib', 'Svelte chat components', 'window'],
  ['cluster-mesh', 'sentropic', '@sentropic/cluster-mesh', 'lib', 'Identity, messaging, storage', 'cluster'],
  ['llm-mesh', 'sentropic', '@sentropic/llm-mesh', 'lib', 'Model provider transports', 'llm'],
  ['llm-gateway', 'sentropic', '@sentropic/llm-gateway', 'lib', 'Seat and model routing', 'network'],
  ['gateway-host', 'sentropic', '@sentropic/llm-gateway-host', 'service', 'apps/llm-gateway process', 'server'],
  ['artifacts', 'sentropic', '@sentropic/artifacts', 'lib', 'Artifact builder runtime', 'document'],
  ['mcp-platform', 'sentropic', '@sentropic/mcp-platform', 'lib', 'MCP composition', 'api'],
  ['harness', 'sentropic', '@sentropic/harness', 'cli', 'Branch and scope checks', 'check'],
  ['api', 'sentropic', 'sentropic-api', 'service', 'api/ · HTTP, SSE, MCP', 'server'],
  ['ui', 'sentropic', 'sentropic-ui', 'service', 'ui/ · SvelteKit application', 'web'],
  ['postgres', 'sentropic', 'Postgres', 'store', 'Host-provisioned storage', 'postgres'],
  ['memory-compose', 'sentropic', '@sentropic/cluster-mesh', 'function', 'composeEngramMemoryDefinition', 'join'],
  ['h2a', 'h2a', '@sentropic/h2a', 'cli', 'Agent sessions and core loop', 'robot'],
  ['h2a-mcp', 'h2a', '@sentropic/h2a', 'service', 'h2a mcp-serve', 'api'],
  ['h2a-cli', 'h2a', '@sentropic/h2a-cli', 'cli', 'Deprecated compatibility relay', 'link'],
  ['h2a-runtime', 'h2a', '@sentropic/h2a-runtime', 'lib', 'Run, launch and delegate', 'robot'],
  ['track', 'h2a', '@sentropic/track', 'cli', 'track · repository event logs', 'map'],
  ['track-mcp', 'h2a', '@sentropic/track', 'service', 'track-mcp', 'api'],
  ['focus', 'h2a', '@sentropic/focus', 'lib', 'Decision dossier model', 'document'],
  ['focus-build', 'h2a', '@sentropic/h2a', 'function', 'buildFocusDossier', 'document'],
  ['track-log', 'sentropic', '.track/', 'store', 'Local log in each consumer repo', 'document'],
  ['engram', 'engram', '@sentropic/engram', 'lib', 'Ontology-typed memory graph', 'brain'],
  ['engram-mcp', 'engram', '@sentropic/engram/mcp-memory', 'service', 'MCP memory; injected storage', 'api'],
  ['svelte', 'design-system', '@sentropic/design-system-svelte', 'lib', 'Standard scene, cards and zones', 'window'],
  ['diagram-core', 'design-system', '@sentropic/diagram-core', 'lib', 'Semantic documents and views', 'graph'],
  ['diagram-canvas', 'design-system', '@sentropic/diagram-canvas', 'lib', 'Layout, routing and fold', 'map'],
];
export const repos = ['sentropic', 'h2a', 'engram', 'design-system'];
export const registry = m3ProfileRegistry;
export const bindings = shippedExecutorBindings;
const entity = id => `entity:${id}`;
export const occurrence = id => `occurrence:e.${id}`;
const nature = { lib: 'PACKAGE', cli: 'EXECUTION', service: 'EXECUTION', store: 'STORAGE', function: 'CAPABILITY' };

export function ecosystemInput(selectedRepos = repos) {
  const rows = inventory.filter(row => selectedRepos.includes(row[1]));
  const document = {
    documentId: 'document:sentropic-ecosystem', schemaVersion: CURRENT_SCHEMA_VERSION, revision: 1,
    profileRefs: ['archimate@2'], typeDefinitions: {}, entities: {}, relations: {}, ports: {}, resources: {}, extensions: [],
  };
  const presentation = { contractPin: { ...DIAGRAM_PRESENTATION_CONTRACT_PIN }, entities: {}, legends: {}, categoryTokens: [] };
  const add = (id, type, title, card) => {
    document.entities[entity(id)] = { id: entity(id), profile: 'archimate@2', type, attributes: { name: { kind: 'text', value: title }, ...(type === 'grouping' ? {} : { layer: { kind: 'enum', value: 'application' } }) } };
    presentation.entities[occurrence(id)] = card;
  };
  for (const repo of selectedRepos) add(`repo-${repo}`, 'grouping', repo, {
    form: 'container', icon: 'cluster', text: { kicker: 'REPOSITORY', title: repo, subtitle: `${rows.filter(row => row[1] === repo).length} existing components`, footer: `repo: ${repo}` },
  });
  for (const [id, repo, pkg, kind, capability, icon] of rows) {
    add(id, kind === 'function' ? 'application-function' : kind === 'store' ? 'data-object' : 'application-component', pkg, { form: 'card', icon, text: {
      kicker: `${nature[kind]} · ${kind.toUpperCase()}`, title: pkg, body: capability,
      footer: `repo: ${repo} · ${pkg}`,
    } });
    const key = `relation:contains.${id}`;
    document.relations[key] = { id: key, profile: 'archimate@2', type: 'groupingContainment', attributes: {}, endpoints: [{ role: 'parent', target: entity(`repo-${repo}`) }, { role: 'child', target: entity(id) }] };
  }
  for (const [source, target] of [
    ['gateway-host', 'llm-gateway'], ['llm-gateway', 'llm-mesh'],
    ['api', 'chat-server'], ['ui', 'chat-ui'], ['api', 'cluster-mesh'],
    ['memory-compose', 'engram-mcp'], ['engram-mcp', 'postgres'],
    ['h2a-cli', 'h2a'], ['focus-build', 'focus'], ['track', 'track-log'],
    ['svelte', 'diagram-canvas'], ['diagram-canvas', 'diagram-core'],
  ]) {
    if (!document.entities[entity(source)] || !document.entities[entity(target)]) continue;
    const id = `relation:uses.${source}.${target}`;
    document.relations[id] = { id, profile: 'archimate@2', type: 'association', attributes: {}, endpoints: [{ role: 'source', target: entity(source) }, { role: 'target', target: entity(target) }] };
  }
  return { document, presentation, registry, bindings };
}
