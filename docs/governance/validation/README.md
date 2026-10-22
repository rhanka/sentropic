# Governance r10 validation

Historical evidence. See [r11 validation](r11.md) for the current portable and owner corrections.

Portable SHA-256:
`80a46eadca1b5b82250f4a599b7233c6feda68e10faa04f836856708b1f6556c`.

The checks below ran in isolated Node 24 / Playwright 1.63.0 containers, using
`make -C docs/governance/kit … ENV=test-governance-contract`.

| Check | Evidence and result |
| --- | --- |
| Source contract | `check-source` passed: G1/G2/G3 accepted on 2026-10-19, exact owner quotes, one retained choice per decision, 18 clauses, 33 needs, English translations and source/geometry digest. |
| Geometry | [geometry-review.json](geometry-review.json): 102 scenes, 732 edge instances, zero failures across all 15 geometric categories. |
| Browser matrix | [browser-review.json](browser-review.json): all 16 combinations of 1920×1080 / 390×844, FR/EN, light/dark and collapsed/expanded passed. |
| Interaction | 324 mouse/touch/control interactions passed, including frame toggles and mobile pinch zoom; no page errors or external HTTP requests. Measured text/boundary contrast checks passed. |
| Content | [supplement-review.json](supplement-review.json): 32 slide visits, 52 grouped-route selections, unchanged owner quotes, settled decisions locked, notes preserved through language switches, storage-denied mode passed. |
| Static README SVG | [static-review.json](static-review.json): 11 images in both themes, text containment, no script/foreignObject, successful image embedding at 1200/390 px. |
| Rebuild | `prepare` reproduced all three precomputed geometry files byte for byte; the subsequent `build` reproduced the portable digest above. [rebuild.sha256](rebuild.sha256) records the four files, relative to the repository root. |

Representative screenshots are included for all viewport/language/theme/state
dimensions, plus the overview and Design System SVG in both themes. The complete
16-view screenshot matrix can be regenerated with `check-browser`; its output
goes to the ignored `kit/.cache/` directory.

The Docker mount initially placed the kit at `/work` and its parent at `/inputs`,
breaking relative evidence reads. Mounting the parent at `/inputs` and running
from `/inputs/kit` fixed the reproduced `ENOENT`. The build and all checks then
passed with no relaxation of assertions.

These are author-run automated and visual checks. A fresh independent r10
consensus is **not recorded**; see [review selection](review-selection.md).
The requested delivery remains a draft PR, with no merge authorization.
