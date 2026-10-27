import { collapseGovernanceScene } from '../src/governance-collapse.js';

// Preparation is bounded. Large fold spaces retain the engine's qualified runtime path.
export function prepareDossierScenes(scenes) {
  const ids = new Set();
  return Object.fromEntries(Object.entries(scenes).map(([key, scene]) => {
    if (ids.has(scene.id)) throw new Error(`Duplicate scene identity: ${scene.id}`);
    ids.add(scene.id);
    if (scene.groups.length > 8) throw new Error(`Declare bounded prepared folds for ${scene.id}`);
    const preparedFolds = [];
    for (let mask = 1; mask < 2 ** scene.groups.length; mask++) {
      const collapsed = scene.groups.filter((_, i) => mask & (1 << i)).map(group => group.id);
      const result = collapseGovernanceScene(scene, collapsed, false);
      preparedFolds.push({ signature: result.routingSignature, edges: result.edges });
    }
    return [key, { ...scene, routingVersion: 'orthogonal-v1', preparedFolds }];
  }));
}

export function sliceTranslations(dictionary, input, uiSources = []) {
  const strings = new Set();
  const collect = value => {
    if (typeof value === 'string') { strings.add(value); strings.add(value.trim()); }
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(input);
  // Include UI literals, including ternary alternatives and template fragments.
  // Match dictionary keys against source text without evaluating consumer code.
  return Object.fromEntries(Object.entries(dictionary).filter(([key]) => strings.has(key)
    || uiSources.some(source => source.includes(key) || source.includes(JSON.stringify(key).slice(1, -1)))));
}
