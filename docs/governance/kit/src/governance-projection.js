import routes from './governance-routes.json' with { type: 'json' };

export function projectGovernanceScene(scene, highlight = null) {
  if (scene.id !== 'central' || scene.projectionKey) return scene;
  const key = highlight?.needId ?? 'overview';
  const localized = routes[scene.language ?? 'fr'] ?? routes;
  if (!localized[key]) throw new Error(`Unknown governance route: ${key}`);
  return { ...scene, projectionKey: key, detailedEdges: scene.edges, edges: localized[key] };
}
