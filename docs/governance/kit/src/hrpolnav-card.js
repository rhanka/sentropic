import { diagramIcon } from './architecture-icons.js';
import { dossierBoldFont } from './hrpolnav-card-font.js';

export function renderStructuredCard(node, escapeXml, { folded = false, toggle = '' } = {}) {
  // One card anatomy; a folded zone uses its free body for the subtitle.
  const ruleY = node.position.y + 10 + (22 + 32 + 24 * 2) * 1.3 + 6 + 4 + .5;
  return `<foreignObject x="${node.position.x}" y="${node.position.y}" width="${node.width}" height="${node.height}">
    <div xmlns="http://www.w3.org/1999/xhtml" class="service-node card-tier-${node.data.cardTier ?? 'service'}${folded ? ' card-folded' : ''}" data-card-tier="${node.data.cardTier ?? 'service'}">
      <header><svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 70 70" aria-hidden="true">${diagramIcon(node.data.cardIcon, 0, 0, 70)}</svg>
        <div class="card-head"><span class="card-code">${escapeXml(node.data.kicker)}</span><strong class="service-name">${escapeXml(node.data.title)}</strong></div>${toggle}
      </header>
      <span class="card-gap" aria-hidden="true"></span>
      <div class="card-body">${folded ? `<span class="card-summary">${escapeXml(node.data.subtitle ?? '')}</span>` : `
        <span class="card-name" data-text="function">${escapeXml(node.data.function)}</span>
        <span class="card-detail" data-text="detail">${escapeXml(node.data.detail)}</span>`}
      </div>
      ${folded ? '' : `<span class="card-rule" aria-hidden="true"></span>
      <strong class="repo-label">${escapeXml(node.data.cardFooter ?? node.data.kicker)}</strong>`}
    </div>
  </foreignObject>${folded ? '' : `<line class="diagram-card-rule" x1="${node.position.x + 16}" x2="${node.position.x + node.width - 10}" y1="${ruleY}" y2="${ruleY}" vector-effect="non-scaling-stroke"/>`}`;
}

// radar-immobilier fa8133c2:docs/architecture/focus/ServiceNode.svelte:44-54.
// Keep its measured palette local to leaves; frames retain the governance theme.
export const structuredCardStyle = `
@font-face { font-family: 'Dossier Inter'; src: url('${dossierBoldFont}') format('woff2'); font-style: normal; font-weight: 700; font-display: block; }
.scene-canvas .service-name, .scene-canvas .service-node .repo-label { font-family: 'Dossier Inter', var(--st-font-sans, sans-serif); }
.scene-canvas .service-node { width: 100%; height: 100%; box-sizing: border-box; padding: 8px; display: flex; flex-direction: column; border: 2px solid var(--st-semantic-border-strong); border-left: 8px solid var(--st-semantic-data-category1); background: var(--st-semantic-surface-raised); color: var(--st-semantic-text-primary); text-align: left; }
.scene-canvas .service-node header { display: grid; grid-template-columns:70px minmax(0,1fr); align-items: center; gap: 6px; min-width: 0; flex: 0 0 auto; }
.scene-canvas .service-node header:has(.card-toggle) { grid-template-columns:70px minmax(0,1fr) auto; }
.scene-canvas .card-toggle { align-self:start; }
.scene-canvas .card-head { display: flex; flex-direction: column; justify-content: center; min-width: 0; flex: 1 1 auto; }
.scene-canvas .card-code, .scene-canvas .card-name, .scene-canvas .card-detail, .scene-canvas .service-node .repo-label, .scene-canvas .service-name { display: block; min-width: 0; white-space: normal; }
.scene-canvas .card-code { font-size: 22px; line-height: 1.3; color: var(--st-semantic-text-secondary); letter-spacing: .04em; }
.scene-canvas .service-name { font-size: 32px; line-height: 1.3; font-weight: 700; }
.scene-canvas .card-gap { display: block; height: 6px; flex: 0 0 6px; }
.scene-canvas .card-name, .scene-canvas .card-detail { font-size: 24px; line-height: 1.3; }
.scene-canvas .card-detail { color: var(--st-semantic-text-secondary); }
.scene-canvas .card-rule { display: block; height: 1px; flex: 0 0 1px; margin: 4px 0; background: var(--st-semantic-border-subtle, #bdcad0); }
.scene-canvas .service-node .repo-label { font-size: 24px; line-height: 1.3; flex: 0 0 auto; }
.scene-canvas { --diagram-card-secondary:#52656b; }
.scene-canvas .service-node { --st-semantic-text-secondary:var(--diagram-card-secondary); }
@media (prefers-color-scheme: light) {
  .scene-canvas .diagram-product-kicker { --st-semantic-text-secondary:var(--diagram-card-secondary); }
}
.scene-canvas .service-node.card-tier-service { width:460px; }
.scene-canvas .service-node { --st-semantic-border-strong:#607b82; --st-semantic-data-category1:#145f68; --st-semantic-border-subtle:#bdcad0; --st-semantic-surface-raised:#fff; --st-semantic-text-primary:#172033; }
/* Preserve a visible one-screen-pixel rule when the overview scales below 1:1. */
.scene-canvas .diagram-card-rule { stroke:#bdcad0; stroke-width:1; pointer-events:none; }
.scene-canvas .diagram-card-box { fill:#fff; stroke:none; }
.scene-canvas .card-body { flex: 0 0 auto; min-width: 0; min-height: 0; padding-left: 4px; }
.scene-canvas .service-node header > svg { flex: 0 0 70px; }
.scene-canvas .service-node .repo-label { font-weight: 700; }
.scene-canvas .card-folded .card-body { flex: 1 1 auto; display:flex; align-items:center; justify-content:center; padding:0; margin:0 22px 0 16px; }
.scene-canvas .card-summary { font-size:24px; line-height:1.3; text-align:center; white-space:normal; }
`;
