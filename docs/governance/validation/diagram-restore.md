# Validated diagram restoration

Reference: `7eeb49a1d`, supplied as the immutable
`.tmp/governance-unification/validated-ref/governance-r11-validated-diagram.html`.
Page typography baseline: portable from `4d8a7246e`.

The DS typography change replaced the diagram's measured pixel sizes with page
field tokens, including its embedded bold card font. It also changed the root
from 24px to 16px, changing the frame chips' rem-based dimensions. The SVG frame
buttons remained 24 × 21 screen pixels: reducing the surrounding text made the
symbols disproportionately large. Restore the diagram's own typography and chip
dimensions within the component; keep the page text on the DS typography.

Computed sizes are equal at both 1440 and 1920 pixels:

| Element | Validated reference | Restored |
| --- | --- | --- |
| Card title | 32px | 32px |
| Card body/detail/footer | 24px | 24px |
| Card kicker | 22px | 22px |
| Group title | 27px | 27px |
| Group subtitle / edge label | 21px | 21px |
| Frame chip label | 21px | 21px |
| Frame chip +/- | 20px | 20px |
| SVG control inherited font size | 24px | 24px |
| SVG control face / drawn symbol width | 24 × 21px / 12px | 24 × 21px / 12px |
| Page body (vs 4d8a7246e) | 16px | 16px |
| Page title (vs 4d8a7246e) | 32px | 32px |

The SVG +/- is a path, not a font glyph. Card sizes are computed in SVG units;
the screen scale is also asserted equal (1440: collapsed 0.4918759231905465,
expanded 0.43729481286933686; 1920: collapsed 0.6691285081240768,
expanded 0.5948785292186474).

Evidence directory:
`/home/antoinefa/src/sentropic/.tmp/governance-unification/diagram-restore-shots/`.
Diagram screenshots: `{reference,new}-{1440,1920}-{collapsed,expanded}.png`.
Frame bar screenshots add `-chips` before `.png`. Expanded means only
“Sentropic · Services partagés” has been opened. `acceptance.json` contains
every measured label, control, geometry attribute, scale, and page type value.

Verification passed: source checks; geometry checks (102 scenes, 732 edges,
zero violations); browser comparison in all four requested cases, offline with
no browser errors. Page body, title, lede and dossier typography are unchanged.

Reproduction (from `docs/governance/kit`, after mounting the supplied reference
and saving `git show 4d8a7246e:docs/governance/governance-r11-portable.html` as
`page-baseline-4d8a7246e.html` in the evidence directory):

```sh
make build deliver ENV=test-governance-contract
make check-source check-geometry ENV=test-governance-contract
make check-r11-final R11_FINAL_SHOTS_DIR=/home/antoinefa/src/sentropic/.tmp/governance-unification/diagram-restore-shots 'PROBE_MOUNTS=-v /home/antoinefa/src/sentropic/.tmp/governance-unification:/evidence -v /home/antoinefa/src/sentropic/.tmp/governance-unification/diagram-restore-shots:/r11-final-shots' ENV=test-governance-contract
```

## Expanded zone spacing — spacing31

Chromium SVG measurements in scene pixels. The reconstructed baseline uses the starting head geometry and unchanged header rendering; all central-zone measurements match the live before/after portable within 0.01px.

| Locale | Scene / zone | Above rule before → after | Below rule top/bottom before → after | Height before → after |
|---|---|---:|---:|---:|
| FR | central / h2a | 26.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 468.00 → 389.39 |
| FR | central / surfaces | 26.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 468.00 → 389.39 |
| FR | central / cluster-mesh | 61.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 1445.00 → 1169.76 |
| FR | central / cm-catalog | 72.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 1142.00 → 980.37 |
| FR | central / cat-mcp | 26.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 468.00 → 389.39 |
| FR | central / cm-storage | 72.61 → 4.00 | 72.00/372.00 → 16.00/16.00 | 1142.00 → 702.98 |
| FR | central / cm-security | 31.02 → 4.00 | 72.00/372.00 → 16.00/16.00 | 1142.00 → 702.98 |
| FR | central / cm-cluster | 72.61 → 4.00 | 72.00/372.00 → 16.00/16.00 | 1142.00 → 702.98 |
| FR | central / engram | 61.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 503.00 → 389.39 |
| FR | central / design-system | 61.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 503.00 → 389.39 |
| FR | annotate / ann-ui | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | annotate / ann-auth | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | annotate / ann-comments | 81.21 → 4.00 | 72.00/40.00 → 16.00/16.00 | 609.00 → 451.79 |
| FR | annotate / ann-h2a | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | annotate / ann-engram | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | ontologies / onto-graph | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | ontologies / onto-skills | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | ontologies / onto-layout | 30.41 → 4.00 | 72.00/40.00 → 16.00/16.00 | 527.00 → 420.59 |
| FR | ontologies / onto-bpmn | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | ontologies / onto-boundary | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | memory / mem-core | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | memory / mem-time | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | memory / mem-pipeline | 65.41 → 4.00 | 72.00/40.00 → 16.00/16.00 | 562.00 → 420.59 |
| FR | memory / mem-live | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | memory / mem-h2a | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | traceability / trace-1-2 | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | traceability / trace-3-4 | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | traceability / trace-5-6 | 30.41 → 4.00 | 72.00/40.00 → 16.00/16.00 | 527.00 → 420.59 |
| FR | traceability / trace-7 | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| FR | traceability / trace-loop | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | central / h2a | 26.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 468.00 → 389.39 |
| EN | central / surfaces | 26.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 468.00 → 389.39 |
| EN | central / cluster-mesh | 61.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 1445.00 → 1169.76 |
| EN | central / cm-catalog | 72.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 1142.00 → 980.37 |
| EN | central / cat-mcp | 26.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 468.00 → 389.39 |
| EN | central / cm-storage | 72.61 → 4.00 | 72.00/372.00 → 16.00/16.00 | 1142.00 → 702.98 |
| EN | central / cm-security | 31.02 → 4.00 | 72.00/372.00 → 16.00/16.00 | 1142.00 → 702.98 |
| EN | central / cm-cluster | 72.61 → 4.00 | 72.00/372.00 → 16.00/16.00 | 1142.00 → 702.98 |
| EN | central / engram | 26.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 468.00 → 389.39 |
| EN | central / design-system | 26.61 → 4.00 | 72.00/16.00 → 16.00/16.00 | 468.00 → 389.39 |
| EN | annotate / ann-ui | 61.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 527.00 → 389.39 |
| EN | annotate / ann-auth | 26.61 → 4.00 | 72.00/75.00 → 16.00/16.00 | 527.00 → 389.39 |
| EN | annotate / ann-comments | 112.41 → 4.00 | 72.00/40.00 → 16.00/16.00 | 609.00 → 420.59 |
| EN | annotate / ann-h2a | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | annotate / ann-engram | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | ontologies / onto-graph | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | ontologies / onto-skills | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | ontologies / onto-layout | 30.41 → 4.00 | 72.00/40.00 → 16.00/16.00 | 527.00 → 420.59 |
| EN | ontologies / onto-bpmn | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | ontologies / onto-boundary | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | memory / mem-core | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | memory / mem-time | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | memory / mem-pipeline | 30.41 → 4.00 | 72.00/40.00 → 16.00/16.00 | 527.00 → 420.59 |
| EN | memory / mem-live | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | memory / mem-h2a | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | traceability / trace-1-2 | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | traceability / trace-3-4 | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | traceability / trace-5-6 | 30.41 → 4.00 | 72.00/40.00 → 16.00/16.00 | 527.00 → 420.59 |
| EN | traceability / trace-7 | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |
| EN | traceability / trace-loop | 26.61 → 4.00 | 72.00/40.00 → 16.00/16.00 | 492.00 → 389.39 |

Baseline: `dd7c35b227fcaf6f9605acac6062346bdcfc8329`. Measurements cover all 60 expanded FR/EN zone occurrences, including subtitles of two, three and four lines. Every zone shrinks. Shorter headers move as a block to keep child rows aligned without adding space after their subtitles.

Routing uses a 4px clearance along expanded frames and above first-row cards; labels stay in wider gutters or outside frames. No extra frame height is reserved for edges.

Preservation: 144 cards / 720 fields and all header wording/wrapping remain unchanged; 24 fully collapsed states retain identical geometry and routes. Six central row checks have exactly 0px deviation. Chromium file URLs load the title and visible diagram without console errors. Zero clipped or ellipsized fields.

Validation: source; 102 scenes / 732 edges with zero geometry violations; 16 browser captures / 600 interactions (worst 1475.0ms, unchanged 1800ms budget); 32 content slides / 52 need routes. Performance: load ≤ 146.3ms, expand-all ≤ 59.2ms, idle script 0ms per ten seconds.

EN screenshots at 1920px: `cluster-mesh-expanded-en.png`, `surfaces-expanded-en.png`, `h2a-expanded-en.png` under `/home/antoinefa/src/sentropic/.tmp/governance-unification/spacing31-shots/`. The same directory contains raw measurements, row/preservation checks and compact browser/performance evidence. Temporary traces and intermediate outputs are removed after verification.

Portable SHA-256: `831cbdee9bb5820e7e19ed55c942522a5848c402db9be0c89d87d02559bf6f35`.
