import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const sourcePath = 'ui/src/app.print.css';
// Reproduce the specification's 441-line census, including media/page preludes.
export function selectorLines(css) {
  return css.split('\n').flatMap((text, index) =>
    /^\s*\S.*(?:\{|,)\s*$/.test(text)
      ? [{ line: index + 1, selector: text.trim().replace(/\s*\{$/, '').replace(/,$/, '') }] : []);
}

const parts = [
  [/report-cover-page/, 'cover'], [/report-cover-header/, 'cover-header'],
  [/report-cover-title/, 'cover-title'], [/report-cover-subtitle/, 'cover-subtitle'],
  [/report-cover-summary/, 'cover-summary'],
  [/toc-item-nested/, 'toc-nested-item'], [/toc-item/, 'toc-item'],
  [/toc-title/, 'toc-title'], [/toc-link/, 'toc-link'],
  [/toc-dots/, 'toc-dots'], [/toc-page/, 'toc-page'],
  [/report-table-of-contents/, 'toc'],
  [/scatter-plot-click-hint/, 'scatter-hint'],
  [/report-scatter-plot-container.*absolute/, 'scatter-controls'],
  [/report-scatter-plot-container.*relative/, 'scatter-canvas-frame'],
  [/report-scatter-plot-container/, 'scatter'],
  [/annex-title/, 'annex-title'], [/usecase-annex-item/, 'annex-item'],
  [/description-compact-print/, 'compact-content'],
  [/technologies-content/, 'technologies'], [/data-sources-content/, 'data-sources'],
  [/data-objects-content/, 'data-objects'], [/references-content|ref-/, 'references'],
  [/rounded-t-lg|px-3\.py-2/, 'field-heading'],
  [/space-y-4.*h4/, 'score-axis-title'], [/space-y-4.*h5/, 'score-item-title'],
  [/space-y-4.*svg/, 'score-rating'], [/space-y-4.*p/, 'score-description'],
  [/space-y-4/, 'scores'], [/flex\.items-center\.gap-[123].*svg/, 'rating'],
  [/flex\.items-center\.gap-3/, 'score-summary'],
  [/prose|markdown-wrapper/, 'content'], [/border-b/, 'field-heading'],
  [/rounded-lg|shadow-xs|\.border|bg-white|bg-slate/, 'field-card'],
  [/\bh1\b/, 'title'], [/\bh2\b/, 'section-heading'],
  [/\bh3\b/, 'field-heading'], [/\bh[45]\b/, 'content-heading'],
  [/\bsvg\b/, 'icon'], [/\b(?:ul|ol|li)\b/, 'list'],
  [/\bp\b/, 'paragraph'], [/\ba(?:\b|\[)/, 'link'],
  [/print-only|print-block/, 'print-only'],
  [/grid|space-y|gap-/, 'row'], [/text-(?:xs|sm|xl|2xl)/, 'field-value'],
];

export function destination(selector) {
  if (selector.startsWith('@page')) return { target: 'paged media', hook: selector };
  if (selector.startsWith('@media')) return { target: 'print media', hook: '@media print' };
  if (/toast-container|navigation-guard|queue-monitor|spinner|loading|animate-spin/.test(selector)) {
    return { target: 'transient utility UI', hook: '[data-print-hidden]' };
  }
  if (/^(?:header|nav|button|\.no-print|\.print-hidden)/.test(selector)) {
    return { target: 'screen-only controls', hook: '[data-print-hidden]' };
  }
  if (selector === '#svelte') return { target: 'candidate mount', hook: '#app' };
  if (/^(?:html|body|\*|canvas|table|th|a\b|pre|img)/.test(selector)) {
    return { target: 'document content', hook: `[data-print-root] ${selector}` };
  }
  if (/overflow|slim-scroll|min-h-screen|main\.mx-auto/.test(selector)) {
    return { target: 'print frame', hook: '[data-print-root]' };
  }
  const scope = selector.includes('template-initiative') ? '[data-print-template="initiative"]' :
    selector.includes('template-dashboard') ? '[data-print-template="dashboard"]' : '[data-print-root]';
  const layouts = [...selector.matchAll(/\.(layout-head|layout-main|layout-bottom|layout-quad|column-a|column-b|report-introduction|report-analyse|report-break-after)\b/g)]
    .filter(match => !selector.slice(0, match.index).endsWith(':not(')).map(match => match[1]);
  const part = parts.find(([pattern]) => pattern.test(selector))?.[1];
  const layoutHook = [...new Set(layouts)].map(token => ` [data-print-layout~="${token}"]`).join('');
  return {
    target: `${scope.includes('initiative') ? 'initiative' : 'report'} ${layouts.join(' ')} ${part ?? 'frame'}`.trim(),
    hook: `${scope}${layoutHook}${part ? ` [data-print-part="${part}"]` : ''}`,
  };
}

export function generate(css) {
  return selectorLines(css).map(row => ({ ...row, ...destination(row.selector) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = generate(readFileSync(sourcePath, 'utf8'));
  if (rows.length !== 441) throw new Error(`Print reference census changed: ${rows.length}`);
  // Bounded files also allow atomic review and commits below 150 lines.
  for (let offset = 0; offset < rows.length; offset += 90) {
    const file = new URL(`print-inventory-${String(offset / 90 + 1).padStart(2, '0')}.json`, import.meta.url);
    writeFileSync(file, `[\n${rows.slice(offset, offset + 90).map(row => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`);
  }
  console.log(`Inventoried ${rows.length} print census lines from ${sourcePath}`);
}
