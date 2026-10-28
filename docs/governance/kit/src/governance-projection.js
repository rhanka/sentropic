export function projectGovernanceScene(scene, highlight = null) {
  if (scene.id !== 'central' || scene.projectionKey) return scene;
  const key = highlight?.needId ?? 'overview';
  const localized = scene.projectionRoutes;
  if (!localized?.[key]) throw new Error(`Missing prepared route for ${scene.id}: ${key}`);
  return { ...scene, projectionKey: key, detailedEdges: scene.edges, edges: localized[key] };
}
