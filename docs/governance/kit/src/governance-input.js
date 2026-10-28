// Full-governance consumer data. Reusable diagram modules never import this file.
import routes from './governance-routes.json' with { type: 'json' };
import layouts from './governance-summary-layouts.json' with { type: 'json' };
import english from './i18n-en.json' with { type: 'json' };
import { configureTranslations } from './i18n.js';

configureTranslations(english);
export { localize } from './i18n.js';
export function bindGovernanceScene(scene) {
  const language = scene.language ?? 'fr';
  const prepared = routes[language];
  if (!prepared || !layouts[language]) throw new Error(`Missing governance inputs: ${language}`);
  return { ...scene, projectionRoutes: prepared, preparedFolds: prepared.folded,
    preparedPlans: prepared.plans, summaryLayout: layouts[language] };
}
