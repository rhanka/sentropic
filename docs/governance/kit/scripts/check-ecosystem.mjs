import { renderCardSvgFromPresentation } from '@sentropic/design-system-svelte/diagram-render';
import { ecosystemInput } from '../src/ecosystem.js';
import { measure } from '../src/ecosystem-measure.js';
const { presentation } = ecosystemInput();
const diagnostics = [];
for (const [entityId, entry] of Object.entries(presentation.entities)) {
  if (entry.form !== 'card') continue;
  const { result } = renderCardSvgFromPresentation(entry, { entityId, measure });
  diagnostics.push(...result.diagnostics);
}
if (diagnostics.length) {
  console.error(JSON.stringify(diagnostics, null, 2));
  throw Error(`Standard DS card diagnostics: ${diagnostics.length}`);
}
console.log('All ecosystem cards fit the standard DS anatomy.');
