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
