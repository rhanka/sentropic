import { EDGE_LABEL_SIZE, sceneFrame, frameHeaderContent, wrapText } from './architecture-layout.js';
import { projectGovernanceScene } from './governance-projection.js';
import { diagramIcon, groupIcons } from './architecture-icons.js';
import { renderStructuredCard, structuredCardStyle } from './hrpolnav-card.js';
import { t } from './i18n.js';

export const svgPalette = {
  neutral: { fill: 'var(--st-semantic-surface-subtle)', stroke: 'var(--st-semantic-text-secondary)', fillVar: '--surface', strokeVar: '--muted' },
  proposal: { fill: 'var(--st-semantic-surface-subtle)', stroke: 'var(--st-semantic-feedback-warning)', fillVar: '--hl-bg', strokeVar: '--hl' },
  identity: { fill: 'var(--st-semantic-surface-subtle)', stroke: 'var(--st-semantic-feedback-info)', fillVar: '--id-bg', strokeVar: '--id' },
};
export const escapeXml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function renderSceneSvg(sceneName, scene, highlight = null, interactive = false) {
  const cardStyle = 'dossier';
  scene = projectGovernanceScene(scene, highlight);
  const frame = sceneFrame(scene);
  const marker = `arrow-${sceneName.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const activeGroups = highlight ? new Set(highlight.groups ?? []) : null;
  const activeNodes = highlight ? new Set(highlight.nodes ?? []) : null;
  const activeEdges = highlight ? new Set(highlight.edges ?? []) : null;
  const markerSize = scene.edges.every(edge => edge.data.summary) ? 12 : 7;
  const defs = `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="${markerSize}" markerHeight="${markerSize}" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>`;
  const bands = scene.bands.map((band, i) => `<text data-band="${i}" x="${band.x ?? 0}" y="${band.y}" font-size="${band.fontSize ?? 16}" font-weight="650">${escapeXml(band.title)}</text>`).join('');
  const groups = (scene.groups ?? []).map((group) => {
    const { x, y } = group.position;
    const palette = svgPalette[group.tone];
    const content = frameHeaderContent(group, group.width);
    const headerY = y + (group.collapsed ? 0 : group.headerOffset ?? 0);
    const subtitle = `<text class="diagram-detail" x="${x + 16}" y="${headerY + 16 + content.contentHeadHeight + 6 + 22}" font-size="24">${content.subtitleLines.map((line, i) => `<tspan x="${x + 16}" dy="${i ? 24 * 1.3 : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
    const header = `${diagramIcon(groupIcons[group.id], x + 16, headerY + 16 + (content.contentHeadHeight - 70) / 2, 70)}<text class="diagram-kicker diagram-product-kicker" x="${x + 92}" y="${headerY + 16 + 22}" font-size="22">${content.kickerLines.map((line, i) => `<tspan x="${x + 92}" dy="${i ? content.kickerLineHeight : 0}">${escapeXml(line)}</tspan>`).join('')}</text><text x="${x + 92}" y="${headerY + 16 + content.kickerLineHeight * content.kickerLines.length + 32}" font-size="32" font-weight="700">${content.titleLines.map((line, i) => `<tspan x="${x + 92}" dy="${i ? content.titleLineHeight : 0}">${escapeXml(line)}</tspan>`).join('')}</text>${subtitle}`;
    const routeState = activeGroups ? (activeGroups.has(group.id) ? ' data-route-state="active"' : ' data-route-state="dimmed"') : '';
    const toggle = interactive ? `<foreignObject data-group-toggle="${escapeXml(group.id)}" data-right="${x + group.width}" x="${x + group.width - 76}" y="${y + 10}" width="76" height="76"><div xmlns="http://www.w3.org/1999/xhtml" data-frame-mount="${escapeXml(group.id)}" style="display:flex; margin:4px"></div></foreignObject>` : '';
    if (group.collapsed) {
      const card = { ...group, data: { cardIcon: groupIcons[group.id] ?? 'window', kicker:content.kicker,
        title:content.titleLines.join(' '), subtitle:group.subtitle } };
      const cardToggle = interactive ? `<div class="card-toggle" data-group-toggle="${escapeXml(group.id)}"><div data-frame-mount="${escapeXml(group.id)}"></div></div>` : '';
      return `<g data-group="${escapeXml(group.id)}" data-tone="${group.tone}" data-parent="${escapeXml(group.parentId ?? '')}" data-collapsed="true"${routeState}><rect class="diagram-card-box" x="${x}" y="${y}" width="${group.width}" height="${group.height}"/>${renderStructuredCard(card, escapeXml, { folded:true, toggle:cardToggle })}</g>`;
    }
    const rule = !group.collapsed ? `<line class="diagram-card-rule" x1="${x + 16}" x2="${x + group.width - 10}" y1="${y + Math.max(group.headerTextHeight, content.headerTextHeight) - 8}" y2="${y + Math.max(group.headerTextHeight, content.headerTextHeight) - 8}" vector-effect="non-scaling-stroke"/>` : '';
    const legend = (group.legendEntries ?? []).map((entry,i) => {
      const cy = y + group.headerHeight + i*64 + 32;
      const swatch = entry.line ? `<path d="M ${x+32} ${cy} h72" stroke="var(--st-semantic-text-secondary)" stroke-width="2" ${entry.dashed ? 'stroke-dasharray="4 5"' : ''}/>`
        : `<rect x="${x+32}" y="${cy-22}" width="72" height="44" fill="var(--diagram-fill)" stroke="var(--diagram-border)"/>`;
      return `<g data-legend-key="${i}" data-tone="${entry.tone ?? 'neutral'}">${swatch}<text x="${x+120}" y="${cy+8}" font-size="24">${escapeXml(entry.label)}</text></g>`;
    }).join('');
    return `<g data-group="${escapeXml(group.id)}" data-tone="${group.tone}" data-parent="${escapeXml(group.parentId ?? '')}" data-collapsed="${!!group.collapsed}"${routeState}><rect class="diagram-group-box" x="${x}" y="${y}" width="${group.width}" height="${group.height}" rx="0" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.5"/>${rule}${header}${legend}${toggle}</g>`;
  }).join('');
  const edges = scene.edges.map((edge) => {
    const points = edge.data.routedPoints;
    const path = points.map((point, i) => (i === 0 ? `M ${point.x} ${point.y}` : point.y === points[i - 1].y ? `H ${point.x}` : `V ${point.y}`)).join(' ');
    const dash = edge.class === 'legacy' || edge.class === 'reject' ? ' stroke-dasharray="4 5"' : '';
    const isRouteActive = activeEdges ? activeEdges.has(edge.id) : false;
    const routeState = activeEdges ? (isRouteActive ? ' data-route-state="active"' : ' data-route-state="dimmed"') : '';
    const strokeWidth = isRouteActive ? '2.4' : '1.35';
    const description = (edge.data.relations ?? [{ label: edge.label }]).map(relation => relation.label).join(' ; ');
    return `<g data-edge="${escapeXml(edge.id)}" data-source="${escapeXml(edge.source)}" data-target="${escapeXml(edge.target)}" data-edge-class="${edge.class}"${routeState}><title>${escapeXml(description)}</title><path class="diagram-arrow" d="${path}" fill="none" stroke="var(--st-semantic-text-secondary)" stroke-width="${strokeWidth}"${dash} ${edge.data.marker === false ? '' : `marker-end="url(#${marker})"`}/></g>`;
  }).join('');
  // Paint pills after all routes so their opaque fill masks only their carrier.
  const labels = scene.edges.map(edge => {
    const box = edge.data.labelBox, point = edge.data.labelPoint;
    const size = edge.data.labelFontSize ?? EDGE_LABEL_SIZE;
    const lines = edge.data.labelLines ?? [edge.label];
    const firstY = point.y - (lines.length - 1) * size * .65 + size * .35;
    return `<g class="diagram-edge-pill" data-label-for="${escapeXml(edge.id)}"><rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" rx="3"/><text data-edge-label="${escapeXml(edge.id)}" x="${point.x}" y="${firstY}" text-anchor="middle" font-size="${size}">${lines.map((line, i) => `<tspan x="${point.x}" dy="${i ? size * 1.3 : 0}">${escapeXml(line)}</tspan>`).join('')}</text></g>`;
  }).join('');
  const junctions = (scene.junctions ?? []).filter((point, i, all) => all.findIndex((p) => p.position.x === point.position.x && p.position.y === point.position.y) === i).map((point) => `<circle data-junction="${escapeXml(point.id)}" cx="${point.position.x}" cy="${point.position.y}" r="2.5" fill="var(--st-semantic-text-secondary)"/>`).join('');
  const nodes = scene.nodes.map((node) => {
    const { x, y } = node.position;
    const palette = svgPalette[node.data.tone];
    const isRouteActive = activeNodes ? activeNodes.has(node.id) : false;
    const routeState = activeNodes ? (isRouteActive ? ' data-route-state="active"' : ' data-route-state="dimmed"') : '';
    const strokeWidth = isRouteActive ? '2.2' : '1.2';
    if (node.data.cardIcon) {
      return `<g data-node="${escapeXml(node.id)}" data-tone="${node.data.tone}" data-parent="${escapeXml(node.parentId ?? '')}" data-kind="${escapeXml(node.data.kind ?? 'component')}"${routeState}><rect class="diagram-card-box" x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="0"/>${renderStructuredCard(node, escapeXml)}</g>`;
    }

  }).join('');
  const activeNeedAttr = highlight?.needId ? ` data-active-need="${escapeXml(highlight.needId)}"` : '';
  const style = `<style>
    /* Keep the validated diagram's inherited size local to the SVG. */
    .architecture-svg { font-size:24px; }
    .architecture-svg { --diagram-surface:var(--st-semantic-surface-raised); --diagram-muted:color-mix(in srgb,var(--st-semantic-text-secondary) 75%,var(--st-semantic-text-primary)); --diagram-info:var(--st-semantic-feedback-info); --diagram-warning:var(--st-semantic-feedback-warning); background:color-mix(in srgb,var(--st-semantic-text-secondary) 8%,var(--st-semantic-surface-subtle)); }
    .architecture-svg [data-tone] { --diagram-tone:var(--st-semantic-text-secondary); --diagram-fill:color-mix(in srgb,var(--diagram-tone) 13%,var(--diagram-surface)); --diagram-border:color-mix(in srgb,var(--diagram-tone) 70%,var(--st-semantic-text-primary)); }
    .architecture-svg [data-tone="proposal"], .architecture-svg [data-tone="warning"] { --diagram-tone:var(--diagram-warning); }
    .architecture-svg [data-tone="identity"], .architecture-svg [data-tone="info"] { --diagram-tone:var(--diagram-info); }
    .architecture-svg [data-tone="critical"] { --diagram-tone:var(--st-semantic-feedback-error); }
    .architecture-svg [data-tone="positive"] { --diagram-tone:var(--st-semantic-feedback-success); }
    .architecture-svg .diagram-group-box { fill:color-mix(in srgb,var(--diagram-tone) 6%,var(--diagram-surface)); stroke:var(--diagram-border); }
    .architecture-svg [data-group] > text { line-height:1.3; fill:#172033; }
    .architecture-svg [data-group] > .diagram-detail { fill:#172033; }
    .architecture-svg [data-group] > text:not(.diagram-detail):not(.diagram-product-kicker) { font-family:'Dossier Inter',var(--st-font-sans,sans-serif); font-weight:700; }
    .architecture-svg .diagram-card-box { fill:var(--diagram-fill); stroke:var(--diagram-border); }
    .architecture-svg .diagram-card-accent { stroke:var(--diagram-tone); }
    .architecture-svg .diagram-detail, .architecture-svg .diagram-kicker { fill:var(--diagram-muted); }
    .architecture-svg .diagram-kicker { letter-spacing:.04em; }
    .architecture-svg [data-group] > .diagram-product-kicker { fill:var(--diagram-card-secondary); font-family:var(--st-font-sans,sans-serif); font-weight:400; }
    /* Card text keeps its fixed palette; provide the same contrast in dark mode. */
    @media (prefers-color-scheme: dark) {
      .architecture-svg .diagram-group-box { fill:#fff; stroke:#718c93; }
    }
    .architecture-svg .icon-base { fill:color-mix(in srgb,var(--diagram-info) 18%,var(--diagram-surface)); }
    .architecture-svg .icon-face { fill:color-mix(in srgb,var(--diagram-info) 75%,var(--diagram-surface)); stroke:var(--diagram-info); stroke-width:1.5; stroke-linejoin:round; }
    .architecture-svg .icon-line { fill:none; stroke:var(--diagram-surface); stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; }
    .architecture-svg .icon-line.dark { stroke:var(--diagram-info); }
    .architecture-svg .diagram-status circle { fill:var(--diagram-surface); stroke:var(--diagram-warning); stroke-width:1.5; stroke-dasharray:3 2; }
    .architecture-svg .diagram-status path { fill:none; stroke:var(--diagram-warning); stroke-width:2; stroke-linecap:round; }
    .architecture-svg .diagram-edge-pill rect { fill:var(--st-semantic-surface-subtle); stroke:var(--st-semantic-text-secondary); stroke-width:1; }
    .architecture-svg .diagram-edge-pill text { fill:var(--st-semantic-text-primary); }
    .architecture-svg[data-card-style="dossier"] .diagram-group-box { rx:0; }
    ${structuredCardStyle}
  </style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="architecture-svg scene-canvas" data-card-style="${cardStyle}" width="${frame.width}" height="${frame.height}" viewBox="${frame.left} ${frame.top} ${frame.width} ${frame.height}" role="${interactive ? 'group' : 'img'}" aria-labelledby="${marker}-title ${marker}-desc"${activeNeedAttr} style="font-family:var(--st-font-sans,system-ui,sans-serif);color:var(--st-semantic-text-primary);fill:var(--st-semantic-text-primary)"><title id="${marker}-title">${escapeXml(sceneName)}</title><desc id="${marker}-desc">${escapeXml(scene.shortCaption)}</desc>${defs}${style}${groups}${bands}${edges}${junctions}${nodes}${labels}</svg>`;
}
