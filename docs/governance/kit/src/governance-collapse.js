import { aggregateTopLevel, packTopLevel } from './governance-summary.js';
import { routeScene } from './architecture-routing.js';
import { packGovernanceScene } from './governance-layout.js';
import { packStudyScene } from './study-layout.js';

// Revisited mixed folds reuse exact geometry, without any eager route work.
const runtimeRoutes = new Map();

// Fold the responsibility tree, measuring visible content on both axes.
// Relations internal to a folded box disappear; external relations reach its border.
export function collapseGovernanceScene(scene, collapsedIds = [], usePrepared = true, planHint) {
  if (!collapsedIds.length) return scene;
  const collapsed = new Set(collapsedIds);
  const originals = new Map([...scene.groups, ...scene.nodes].map(entry => [entry.id, entry]));
  const representative = id => {
    let visible = id;
    for (let parent = originals.get(id)?.parentId; parent; parent = originals.get(parent)?.parentId) {
      if (collapsed.has(parent)) visible = parent;
    }
    return visible;
  };
  const summary = scene.projectionKey === 'overview' && scene.groups.filter(g => !g.parentId).every(g => collapsed.has(g.id));
  const packed = summary ? packTopLevel(scene) : scene.id === 'central'
    ? packGovernanceScene(scene, collapsedIds) : packStudyScene(scene, collapsedIds);
  const visibleGroups = packed.groups, nodes = packed.nodes;
  const projectedEdges = scene.edges.map(edge => ({
    ...edge, source: representative(edge.source), target: representative(edge.target),
    data: { labelFontSize: edge.data.labelFontSize, marker: edge.data.marker, pillLabel: edge.data.pillLabel },
  })).filter(edge => edge.source !== edge.target);
  const byEndpoints = new Map();
  for (const edge of projectedEdges) {
    const key = `${edge.source}:${edge.target}`;
    const aggregate = byEndpoints.get(key);
    const relation = { id: edge.id, label: edge.label };
    if (aggregate) {
      aggregate.data.relations.push(relation);
      aggregate.label = `${aggregate.data.relations.length} ${scene.language === 'en' ? 'links' : 'liaisons'}`;
    } else byEndpoints.set(key, { ...edge, data: { ...edge.data, relations: [relation] } });
  }
  const edges = summary ? aggregateTopLevel(scene) : [...byEndpoints.values()];
  const routeInput = { ...scene, groups: visibleGroups,
    nodes: [...nodes, ...visibleGroups.filter(group => group.collapsed)], edges };
  // As with expanded projections, common folds are prepared at build time.
  // Exact geometry guards the cache when card dimensions or routes change.
  const routingSignature = JSON.stringify([
    [...visibleGroups, ...nodes].map(entry => [entry.id, entry.parentId, entry.position.x, entry.position.y, entry.width, entry.height, entry.headerTextHeight, entry.collapsed]),
    edges.map(edge => [edge.id, edge.source, edge.target, edge.label, edge.class, edge.data.labelFontSize, edge.data.marker, edge.data.relations, edge.data.pillLabel]),
  ]);
  const cacheKey = JSON.stringify([scene.id, scene.language, scene.routingVersion ?? 'orthogonal-v1', routingSignature]);
  const prepared = usePrepared && (scene.preparedFolds?.find(entry => entry.signature === routingSignature)
    ?? runtimeRoutes.get(cacheKey));
  const mask = scene.groups.reduce((value,g,i)=>value | (visibleGroups.some(v=>v.id===g.id&&v.collapsed) ? 1<<i : 0),0);
  const plan = planHint ?? (usePrepared && scene.id === 'central' && scene.projectionKey === 'overview'
    ? scene.preparedPlans?.[mask] : undefined);
  const routed = summary ? {...routeInput, edges:packed.edges}
    : prepared ? { ...routeInput, edges: prepared.edges } : routeScene(routeInput,plan);
  if (usePrepared && !summary && !prepared) {
    if (runtimeRoutes.size === 32) runtimeRoutes.delete(runtimeRoutes.keys().next().value);
    runtimeRoutes.set(cacheKey, { edges: routed.edges });
  }
  return { ...routed, nodes, edges: routed.edges.map(edge => ({ ...edge,
    data: { ...edge.data, obstacleDetour: edge.type !== 'straight' } })), collapsedIds, routingSignature };
}
