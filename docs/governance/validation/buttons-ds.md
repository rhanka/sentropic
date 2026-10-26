# PR #711 — Compact DS controls and diagram feedback

## PR #711 — Uniform zone icons and four-pixel card insets (icons14)

Baseline: `0451c437e0719d4816fe9ac60a9d19df9a73406a`; `harness check branch` passed and the named remote branch was pulled with fast-forward only (already current). Reviewed and retained the partial icon changes; completed collapsed subtitle wrapping and card insets.

- Zone icons: 42 → 70 SVG px at every level in FR/EN; card icons remain 70 px. Titles and subtitles start at frame x + 92, leaving the same 6/70 icon-to-text gap ratio as cards. Collapsed subtitles use measured body font advances to fit the existing frames.
- Body left inset addition: +2 → +4 px from the original (bar-to-first-glyph target: 10 → 14 card px, versus 12 at the baseline). Footer bottom inset addition: +2 → +4 px from the original. Cards remain square, 460 × 200 px; no typography or separator changes.
- Shortened strings, applied consistently at the source and translation dictionary: FR `Clé : tenant/espace/namespace/type/id` → `Clé tenant/espace/namespace/type/id` (EN remains `Key: tenant/space/namespace/kind/id`); EN `Authorised session/agent · voluntary use` → `Authorised session/agent · optional use` (FR remains `Session/agent autorisé · adoption libre`). Meaning and component names are preserved.
- Evidence: `.tmp/governance-unification/icons14-shots/measurements.json` and six 1920 × 1080 FR/EN screenshots: overview, Sentropic expanded, and `Mémoire live agents` / `Live agents memory` at an actual 3:1 SVG scale.
- Final offline Chromium audit: title loaded, diagram visible, no console/page errors; 720 fields across 144 cards and 88 zone-header occurrences; 0 FR / 0 EN ellipses, no header/card/edge collisions, unchanged card/frame/edge/label geometry and 0px row deviation. Measured CSS body inset from the accent bar: 10 → 12px at this baseline (+4 from original 8px padding); first-glyph target includes the original glyph side bearing. Measured footer bottom gap excluding border: 11.25 → 13.25px. All cards remain 460 × 200px with 0px corner radius.
- Source and geometry gates pass: 102 scenes / 732 edges, zero crossings, header/card intrusions, overlaps, label collisions or detached endpoints.
- Extended `check-browser` is not green: on the final artifact, two runs reached the existing 1800ms interaction deadline, respectively waiting for the `cm-storage` button to stabilize and while clicking `cluster-mesh` (`scripts/check-browser.mjs:76`). No timeout was increased. A separate cache audit confirms all partially folded FR/EN traversal states hit prepared routes (0–6ms); the targeted offline audit above passes. This extended interaction failure remains unresolved; no merge is requested.

## PR #711 — Two-pixel card inset correction (padding13)

Baseline: `9cb696fcedf973a6fdf99e54a0739252cb82514f`; named remote branch pulled with fast-forward only, already current.
Evidence: `/home/antoinefa/src/sentropic/.tmp/governance-unification/padding13-shots/` (`measurements.json`, `replacements.json`, bilingual 1920px expanded and 100% card screenshots).

Measured from the inner border edge to the text line box: body left 8 → 10px; footer bottom 9.25 → 11.25px (outer-edge distances: 16 → 18px and 11.25 → 13.25px). Body available width: 434 → 432px. The footer moves up 2px independently of layout, retaining the separator position and uniform alignment across cards; separator-to-footer spacing becomes 4 → 2px.

Real offline Chromium measurements cover all 720 fields in 144 FR/EN card occurrences across the five scenes. Result: FR 0, EN 0 clipped fields or literal ellipses. All cards remain 460 × 200; all measured fonts, sizes, weights and line heights match baseline. Names, headers and footer labels remain unchanged; no validated name required shortening. SVG frames, separators and edges match baseline exactly. Actual card screenshots verify SVG scale 1.0 with device scale factor 1.

Seven overflowing strings shortened; every repeated occurrence uses the same replacement, including canonical sources, translation keys and prepared scenes:

| Language | Before | After |
| --- | --- | --- |
| FR | Présentation DS · sélection et marqueurs | Présentation DS · sélection/marqueurs |
| FR | Réception dans la session/rôle h2a cible | Réception : session/rôle h2a cible |
| FR | Création explicite d’item lié à l’annotation | Création explicite d’item d’annotation |
| EN | DecisionDossierDocument · owner choice | DecisionDossierDocument: owner choice |
| EN | Coordination · feedback handling · tooling | Coordination · feedback · tooling |
| EN | Surfaces without backend or native driver | Surfaces: no backend or native driver |
| EN | Local recompute · semantics ≠ geometry | Local recompute: semantics ≠ geometry |

Three additional list reformulations remove four existing literal ellipsis occurrences without dropping list continuation:

| Language | Before | After |
| --- | --- | --- |
| FR | Sessions CLI, Cowork, ADK… | Sessions CLI, Cowork, ADK, etc. |
| EN | CLI, Cowork, ADK sessions… | CLI, Cowork, ADK sessions, etc. |
| FR/EN | annotate · Track · Focus · sessions · … | annotate, Track, Focus, sessions, etc. |

Validation: source, 102 geometry scenes / 732 edges (zero reported collisions), offline browser and content checks; portable rebuilt and checksum manifest refreshed. Static illustrations remain outside this portable-card correction.

## PR #711 — Reference card footers (footer6)

Baseline: `1822b99ea60b7a9c2cbd6121f9f1a85a2f0af531` (naming-5).
Reference: radar-immobilier `fa8133c2:docs/architecture/focus/ServiceNode.svelte:30-54`;
the earlier `63f32086` footer was also read. The current reference supplies the
6px header gap, single-line ellipsis, 1px subtle rule with 4px vertical margins,
and 24px footer at line-height 1.3. The body takes the remaining flex space.
The attribution stays verbatim, including `service: Sentropic`: the reference
renders its supplied `repoLabel` directly. No wording or layout data changed.

All 72 structured card occurrences per locale share this renderer: 28 central
cards and 44 nested study cards. Collapsed frames have no service attribution.
Browser measurements cover all 144 FR/EN occurrences and find 134 occurrences
with single-line ellipsis. The exhaustive card/field list is in
`.tmp/governance-unification/footer6-shots/truncated-cards.md`; `cards-changed.md`
lists every changed occurrence and its unchanged footer value.
Eight before/after geometry comparisons pass for overview, Sentropic expanded,
Storage expanded and fully expanded, in both languages. Six 1920px screenshots
and `verification.json` are in the same evidence directory. Reference not rendered.
Source validation, 102 scenes / 732 edges, 16 browser configurations / 328
interactions, 32 slides / 52 needs and denied-storage operation all pass.
Portable SHA-256:
`2e41c1bc495c9582c5fdbc3fa62f34c7f88d94aa152027e3001072ba70091823`.

Base: `ffcc25c20`. Browser proof is French, offline, at 1440 and 1920 CSS pixels.

The source already used 27/21 SVG-unit frame typography and 32/24 dossier card typography. Commit `ffcc25c20` restored those unequal scales after `4d8a7246e` had replaced both with page DS tokens. It also added local 21px chip text, 20px symbols and 18px horizontal padding. Cards retain their validated 32/24 sizes. Frame titles now use 36 and subtitles 24 in the same SVG coordinate scale, with measured 48/32 line steps.

All page buttons use the pinned DS Button sm, and frame controls use DS IconButton sm ghost with the DS dependency's Lucide Plus/Minus. There is no compact icon-button gap. Controls mount in a foreignObject inside each existing frame node's SVG group, aligned with its title and contained by its border. The portable renderer uses SVG scene nodes rather than a live XYFlow host. DS keyboard-only focus styling owns the ring.

Collapsed boxes derive their height from wrapped header content, without equal-height stretching or a fixed 280-unit box. ELK node spacing falls from 80 to 32 and between-layer spacing from 200 to 64; routing/label clearance is retained. Expanded cards, frame boxes, edge paths and fit remain identical.

Computed dimensions include all controls of each type (not only the first button). Heights are screen CSS pixels; font sizes are computed CSS values.

| Width | Control | Height before | Height after | Font before | Font after |
|---|---|---:|---:|---:|---:|
| 1440 | Complete view | 44 | 32 | 15px | 14px |
| 1440 | 12 view buttons | 44–54 | 32 | 15px | 14px |
| 1440 | Detailed view tabs | 54 | 32 | 15px | 14px |
| 1440 | Frame chips | 44 | 32 | 21px | 14px |
| 1440 | Zoom/action buttons | 44 | 32 | 15px | 14px |
| 1440 | Zoom readout | 21 | 21 | 16px | 14px |
| 1440 | In-frame icon button (screen size) | 21 | 32 | 24px | 24px |
| 1920 | Complete view | 44 | 32 | 15px | 14px |
| 1920 | 12 view buttons | 44–54 | 32 | 15px | 14px |
| 1920 | Detailed view tabs | 44 | 32 | 15px | 14px |
| 1920 | Frame chips | 44 | 32 | 21px | 14px |
| 1920 | Zoom/action buttons | 44 | 32 | 15px | 14px |
| 1920 | Zoom readout | 21 | 21 | 16px | 14px |
| 1920 | In-frame icon button (screen size) | 21 | 32 | 24px | 24px |

The icon button has no text. Its inherited font value is immaterial; the Lucide glyph uses the DS small button font-size token (14px), and its intrinsic compact box is 32px. Canvas zoom scales the complete component.

| Verification | Result |
|---|---|
| Geometry | 102 scenes, 732 edge instances, zero findings |
| Browser | 16 FR/EN × desktop/mobile × light/dark screenshots; 324 interactions; zero browser errors |
| Expanded screenshot diff | 1440: 0/999000 changed pixels; 1920: 0/1848240 changed pixels |
| Expanded geometry | Identical cards, frame boxes, paths, viewBox and fit at both widths |
| Focus | Keyboard Space toggles the frame; DS focus-visible ring; buttons stay inside borders |
| Source | Source digest, translations, owner decisions and 33 needs pass |

Pixel comparison excludes the explicitly authorized frame headers/toggles and edge-label pills, with a two-pixel raster margin. Both isolated canvases are aligned to physical pixels before comparison to avoid page-height-dependent antialiasing. Unmasked before/after captures remain available.

Evidence directory: `/home/antoinefa/src/sentropic/.tmp/governance-unification/buttons-ds-shots/`.

| Capture | Before / after filenames |
|---|---|
| Full controls and canvas, both widths | `{before,after}-{1440,1920}-{collapsed,h2a,surfaces,expanded}-area.png` |
| h2a expanded header | `{before,after}-{1440,1920}-h2a-frame.png` |
| Access surfaces expanded, 1920 | `{before,after}-1920-surfaces-frame.png` |
| Collapsed overview | `{before,after}-{1440,1920}-collapsed-canvas.png` |
| Pixel proof | `{before,after}-{1440,1920}-expanded-masked.png`, `diff-{1440,1920}-expanded.png`, `comparison.json` |
| Computed measurements | `before.json`, `after.json` |
| CSS inspection | `control-css-grep.txt`: no local control font-size, padding or height declarations |

The deployment relation is retained: Integration deploys artifacts/apps to the Cloud surface; it is distinct from access to APIs and catalogue synchronization. “Messages a2a” describes workflow-to-agent delivery, replacing implementation-specific inbox/receipt terminology. “Journaux et métriques” names the observability data sent to knowledge/ontology services. Summary labels and detailed relation labels now belong to the central scene source, with the shared English dictionary. Every central/overview edge starts with a capital and contains no D1=C/C01-style code.

| Old FR label | New FR label | Old EN label | New EN label |
|---|---|---|---|
| mandats et WP | Mandats et WP | mandates and WPs | Mandates and WPs |
| items | Items | items | Items |
| dossiers Focus | Dossiers Focus | Focus dossiers | Focus dossiers |
| accès CLI | Accès CLI | CLI access | CLI access |
| accès Cowork | Accès Cowork | Cowork access | Cowork access |
| accès Cloud | Accès Cloud | Cloud access | Cloud access |
| liaison Cowork | Liaison Cowork | Cowork connection | Cowork connection |
| expose les MCP | Expose les MCP | exposes MCP tools | Exposes MCP tools |
| expose le harnais MCP | Expose le harnais MCP | exposes MCP harness | Exposes MCP harness |
| broker MCP | Broker MCP | MCP broker | MCP broker |
| publie ses outils | Publie ses outils | publishes its tools | Publishes its tools |
| expose les IA | Expose les IA | exposes AI | Exposes AI |
| expose le catalogue | Expose le catalogue | exposes catalogue | Exposes catalogue |
| appels | Appels | calls | Calls |
| autorisation | Autorisation | authorisation | Authorisation |
| intégration | Intégration | integration | Integration |
| inbox et reçus | Messages a2a | inbox and receipts | A2a messages |
| appels IA | Appels IA | AI calls | AI calls |
| états de session | États de session | session states | Session states |
| traces et reçus | Traces et reçus | traces and receipts | Traces and receipts |
| garde et droits | Garde et droits | custody and rights | Custody and rights |
| persiste annotation | Persiste annotation | persists annotation | Persists annotation |
| remise autorisée | Remise autorisée | authorised delivery | Authorised delivery |
| audit des accès | Audit des accès | access audit | Access audit |
| références / hébergement | Références / hébergement | references / hosting | References / hosting |
| synchronise le catalogue | Synchronise le catalogue | syncs catalogue | Syncs catalogue |
| release à déployer | Release à déployer | release to deploy | Release to deploy |
| intégrations providers | Intégrations providers | provider integrations | Provider integrations |
| hébergement | Déploiement des applications | hosting | Application deployment |
| reçus de déploiement | Reçus de déploiement | deployment receipts | Deployment receipts |
| contrats mémoire | Contrats mémoire | memory contracts | Memory contracts |
| contrats ontologies | Contrats ontologies | ontology contracts | Ontology contracts |
| déclare la surface | Déclare la surface | declares surface | Declares surface |
| observations D1=C | Journaux et métriques | D1=C observations | Logs and metrics |
| profils épinglés | Diagram Graphs | pinned profiles | Diagram Graphs |
| annotate via façade MCP | Annotate via façade MCP | annotate via MCP façade | Annotate via MCP façade |
| sérialisation neutre | Sérialisation neutre | neutral serialization | Neutral serialization |
| schéma et skill | Schéma et skill | schema and skill | Schema and skill |
| diagramme central | Diagramme central | central diagram | Central diagram |
| feedback | Feedback | feedback | Feedback |
| rendu UI | Rendu UI | UI rendering | UI rendering |
| descripteurs canvas / UI | Descripteurs canvas / UI | canvas / UI descriptors | Canvas / UI descriptors |
| catalogue logique | Catalogue logique | logical catalogue | Logical catalogue |
| hébergement UI / apps | Hébergement UI / apps | UI / app hosting | UI / app hosting |
| liaison MCP / ui:// | Liaison MCP / ui:// | MCP / ui:// connection | MCP / ui:// connection |
| outils h2a | Outils h2a | h2a tools | Tools for h2a |
| schéma et skill Focus | Schéma et skill Focus | Focus schema and skill | Focus schema and skill |

Portable SHA-256: `e3cb173c063520ab91a98adbfb1f4839b536c31e3363c58ce29881b757ac36e1`.

Reference HTML SHA-256: `87d5d0f232f8875ebb120394a827ed5e33244e8c8a650f53c8d28004fb0b9058`.

## PR #711 polish of 230f17ebe

The all-collapsed overview now fits its content with 24 SVG units on every side,
instead of forcing a 16:9 frame (previous vertical padding: 245.125 units).
ELK receives widths measured from each title at 36 px plus the existing header
slots; all five root titles now occupy one line in French. Port spacing adapts
to the shorter content height, keeping each endpoint inside its frame.

Zone headings previously computed to weight 700 but used the system fallback
`WenQuanYi Zen Hei` in the browser probe. They now use the same embedded
`Inter-Bold` face and 700 weight as the cards (the DS bold typography weight).
Card rendering, controls, labels and expanded geometry remain unchanged.

Evidence: `/home/antoinefa/src/sentropic/.tmp/governance-unification/polish-shots/`.
For each width `1440` and `1920`, compare `before-{width}-collapsed-area.png`
with `after-{width}-collapsed-area.png`, and `before-{width}-h2a-area.png` with
`after-{width}-h2a-area.png`. Matching `*-canvas.png` and `*-h2a-frame.png`
provide closer views. `before.json`, `after.json` and `comparison.json` record
the measurements and actual Chromium font identities.

The comparison asserts identical controls in every state and identical viewBox,
cards, edges, labels and frame boxes with h2a expanded and with all frames
expanded at both widths. Geometry validation covers 102 scenes and 732 edge
instances with zero reported defects. Browser regression checks cover compact
bounds, at most two title lines and embedded bold headings in both languages.

Final browser matrix: 16 configurations, 324 interactions, zero page errors.
Content checks: 32 slides, 52 needs and denied-storage operation passed.
Polished portable SHA-256:
`fcb8503b668f1465485433e79a75edbec6a82d8e25379460dc2751974e866dfc`.

## PR #711 — Uniform collapsed card footprint

The owner's collapsed-ratio feedback supersedes the title-sized collapsed boxes
above. Recursive frame packing and the ELK overview now share a 460 × 272-unit
footprint, matching the validated “Rôles et mandats” leaf in both languages.
Existing leaf heights remain content-dependent and unchanged. Every collapsed
frame uses this reference footprint, including Catalogue's nested MCP frame.
Titles retain the embedded bold face at 36 units, wrap inside the fixed box,
and keep the subtitle below and the DS icon button inside the header.
Collapsed title wrapping uses the embedded font metrics and reserves the toggle
column. Its 44-unit line step fits three title lines plus three subtitle lines;
expanded headers retain their original 48-unit line step.
ELK spacing and the uniform 24-unit overview fit margin are unchanged.

Evidence directory:
`/home/antoinefa/src/sentropic/.tmp/governance-unification/collapsed-size-shots/`.
The baseline HTML is the delivered artifact at `a4f6a738e`.

| Viewport | View | Collapsed boxes | Reference leaf | Ratio |
|---|---|---|---|---|
| 1440 | All-collapsed overview (5 roots) | 460 × 272 | 460 × 272 | 1.691176 |
| 1920 | All-collapsed overview (5 roots) | 460 × 272 | 460 × 272 | 1.691176 |
| 1440 | Sentropic expanded, children collapsed (4 children + 4 other roots) | 460 × 272 | 460 × 272 | 1.691176 |
| 1920 | Sentropic expanded, children collapsed (4 children + 4 other roots) | 460 × 272 | 460 × 272 | 1.691176 |

Dimensions are SVG layout units; viewport fitting scales every box together.
Compare `{before,after}-{1440,1920}-{overview,sentropic}-canvas.png`;
matching `*-area.png` captures include the figure controls.
`check.mjs` records actual browser box measurements in `measurements.json`,
compares them against the baseline leaf in `comparison.json`, checks the deeper
MCP fold, and asserts identical fully expanded cards, group geometry, edge
paths, labels and viewBox at both widths. The browser inspector also checks
text/control containment and collisions between cards, labels and edges.

Final geometry validation: 102 scenes and 732 edge instances, zero findings.
At both requested widths the overview margins measure exactly 24 units on
every side. The before/after comparison passes for all collapsed dimensions,
unchanged leaf dimensions and identical fully expanded geometry.
Offline browser matrix: 16 configurations, 324 interactions, zero page errors.
Content checks: 32 slides, 52 needs and denied-storage operation passed.

Portable SHA-256:
`6a01ef9383de9cbb0b35c185e91d9423ee45ad19a591083a9779c234ba301c52`.

Reproduce with the kit Makefile: `make prepare build deliver check-source check-geometry check-browser check-content ENV=test-governance-contract`; export the baseline HTML from ffcc25c20 to the evidence directory, then `make check-r11-final R11_FINAL_SHOTS_DIR=/home/antoinefa/src/sentropic/.tmp/governance-unification/buttons-ds-shots ENV=test-governance-contract`. No persistent services or host Node/Python were used.

## PR #711 — Owner naming and keyboard focus

Baseline: `2b6c6c05e624a4a3682deedef8825a1ec4ce74de`.
Central scene names and their English dictionary drive the diagram, frame chips,
view tabs, summary and generated scenes. Matching dossier text, README captions
and static image text use the same approved names.

| English | French |
|---|---|
| Sentropic · Agentic Platform | Sentropic · Plateforme agentique |
| h2a · Responsible AI Organization | h2a · Organisation IA responsable |
| CLI · Cowork · 3rd-party and Sentropic apps · AI providers | CLI · Cowork · applis tierces et Sentropic · fournisseurs IA |
| Third-party and Sentropic apps | Applis tierces et Sentropic |
| Design System · Collaborative Human–AI Views | Design System · Vues collaboratives humains–IA |
| Engram · Curated Knowledge | Engram · Savoir curé |
| Enriched by AI, validated by humans · ontologies · memory | Enrichi par l'IA, validé par l'humain · ontologies · mémoire |

English plural `catalogues`/`Catalogues` becomes `catalogs`/`Catalogs`, including
`3. Catalogs` and the platform subtitle. French catalog spelling is unchanged.
The complete before/after string report contains 11 changed French source keys
and 19 changed English dictionary values, including longer text containing the
renamed labels. Repeated UI projections and README captions reuse these strings.

Evidence: `/home/antoinefa/src/sentropic/.tmp/governance-unification/naming-shots/`.
`renamed-strings.md` and `renamed-strings.json` list every changed string.
`{before,after}-1920-{fr,en}-canvas.png` captures the all-collapsed overview;
matching `*-overview.png` files include the page. `before.json` and `after.json`
record text bounds, frame/card geometry, paths and mouse/keyboard focus states.
Both locales retain 460 × 272 collapsed boxes and identical before/after frame
positions, card geometry, edge paths and viewBox, collapsed and fully expanded.
Long titles wrap to four lines where necessary without changing typography or
box sizes. Browser assertions check actual title/subtitle containment.

The original focus defect reproduces after keyboard use followed by a mouse
click: a remounted button received programmatic focus and inherited the DS
focus-visible ring. Frame focus is now restored only for keyboard activation.
The regression checks assert the keyboard ring remains and mouse activation
has neither focus-visible nor box-shadow, including after keyboard use.

Validation: source checks passed; 102 scenes and 732 edge instances have zero
geometry findings; the offline browser matrix passed 16 configurations and 328
interactions; content checks passed 32 slides, 52 needs and denied storage.
All 11 static SVGs passed light/dark image embedding at 1200/390 px. Static
names were applied using the central dictionary while asserting identical
rectangle, path and line geometry against each committed SVG. The existing
general exporter selects a toolbar icon after the earlier DS button changes;
repairing that exporter and refreshing older static geometry are outside this
names-only change.

Portable SHA-256:
`20caf436da0d9aa1c2ca7463a71526786d2a4280fd381c85b3cbbde9e1eec1c0`.

## PR #711 — Left-to-right numbering and collaborative views

Baseline: `1ae011391edb1ca106f3d447c7922e470a01be72`.
Storage / Stockage is now 4; Security and observability / Sécurité et
observabilité is now 5. Sentropic's four child frames read 3, 4, 5, 6 from left
to right without moving any boxes. Central labels and translations feed the
diagram, chips, tiles, text and summary; prepared scenes and static SVG labels
carry the same changes.

| Locale | Zone title | Subtitle |
|---|---|---|
| EN | Design System · Collaborative Views | Annotations · Diagrams · Decision dossiers · AI-ready UI components |
| FR | Design System · Vues collaboratives | Annotations · diagrammes · dossiers de décision · composants UI prêts pour l'IA |

Evidence: `/home/antoinefa/src/sentropic/.tmp/governance-unification/naming3-shots/`.
`{before,after}-1920-{fr,en}-{overview,sentropic}.png` and matching
`*-canvas.png` files capture both requested views. `measurements.json` and
`verification.json` record 460 × 272 collapsed boxes, contained titles and
subtitles without overlap, left-to-right numbering and identical box positions,
cards, edge paths and viewBox in overview, Sentropic-expanded and fully expanded
views. Prepared labels retain existing header clearance and routing coordinates;
the portable and static image manifest are rebuilt from these names.

Validation passed: 102 scenes and 732 edge instances with zero findings;
16 offline browser configurations and 328 interactions; 32 slides, 52 needs
and denied-storage operation; all 11 static SVGs in light/dark at 1200/390 px.

Portable SHA-256:
`ed19f5cb9549d7166639cfd51298c6336640c970d8fdf9997914ee565ddbd56c`.

## Multiline card content correction

The footer from `e18e59440` is preserved. Titles, functions and details wrap
using line budgets derived from each card's unchanged width and height; only
excess lines receive a final-line ellipsis. Font sizes, wording and colours
are unchanged. Browser regression checks require multiline clamps for these slots.

Evidence: `/home/antoinefa/src/sentropic/.tmp/governance-unification/footer7-shots/`.
All 144 FR/EN card occurrences fit above the rule with **zero title/body
truncations**. The remaining 40 FR / 38 EN truncated occurrences are exclusively
the unchanged single-line footer attributions in secondary scenes; their full
text and scene IDs are listed in `truncated-cards.md`. Central cards have none.
Eight FR/EN geometry states match `e18e59440` exactly, including edges and labels;
collapsed cards remain 460 × 272. Each footer stays at the bottom, below the 1px
rule with unchanged 4px margins. Six 1920px captures cover overview, Sentropic
expanded and Storage expanded (`models-1920-{fr,en}.png`). No page errors.
Synthetic overlong title, subtitle and detail cases also remain contained and
use multiline ellipses. Source, 102-scene geometry, 16-configuration/328-interaction
browser and 32-slide/52-need content checks pass. Portable SHA-256:
`e2e8b0187dd36bcb2a79ae217f5b1b0be5be2236cb6e7dbc98322fba561de35e`.

## Uniform reference leaf cards — 2026-10-20

This correction supersedes the variable leaf heights and pinned-footer placement above.
Collapsed frames retain their 460 × 272 footprint and rules.

Reference: read-only radar-immobilier, commit fa8133c2,
docs/architecture/focus/scenes.js:8-13 (460 × 200) and
docs/architecture/focus/ServiceNode.svelte:30-54 (slots and CSS).
The owner-visible architecture-before-after-2026-09-13.html was measured in Chromium at 1920 × 1080.

| Property | Measured reference | Applied |
| --- | --- | --- |
| Leaf size / aspect ratio | 460 × 200 px / 2.30:1 | Same, uniform scale 1:1 |
| Padding | 8 px on all sides | Same |
| Header icon / gap | 70 × 70 / 6 px | Same |
| Kicker | 22 px, weight 400, line-height 1.3, tracking .04em | Same |
| Title | 32 px, weight 700, line-height 1.3 | Same |
| Header height | 70.1875 px (70.2 nominal) | Same |
| Gap below header | 6 px | Same |
| Name and detail | 24 px, weight 400, line-height 1.3 | Same |
| Rule | 1 px, #bdcad0, 4 px above/below | Same; non-scaling SVG stroke preserves one screen pixel below 1:1 |
| Footer | 24 px, weight 700, line-height 1.3 | Same, one line with ellipsis |
| Border / left accent | 2 px #607b82 / 8 px #145f68 | Same |
| Surface / text / secondary | #fff / #172033 / #52656b | Same, scoped to leaves |

Every leaf has fixed dimensions. The reference typography leaves room for one line
per title/name/detail slot: normal wrapping with a one-line CSS clamp supplies the
last-line ellipsis. Full wording remains unchanged in the source and DOM.
The complete FR/EN list below includes every repeated scene occurrence and footer.

Verification: 144 FR/EN leaf occurrences, all 460 × 200, with text
and icons contained. Six central states preserve frame hierarchy/order/labels,
edge identities/endpoints/labels and full card wording. Both collapsed overviews
retain identical geometry. Existing packing/routing algorithms only move positions
to accommodate the new dimensions. Rendered pixel comparisons with rules hidden
verify visibility along >95% of each usable rule width in the owner view and fully
expanded view at 1920 px in FR/EN.

Checks passed: 102 geometry scenes / 732 edges with zero violations;
16 offline browser configurations / 328 interactions; 32 slides / 52 need views;
storage-denied behavior and source checks. Reference leaves keep their white surface
in both themes: text contrast >= 4.5 and border-to-fill contrast >= 3 are checked.
Frame contrast gates remain unchanged. Static illustrations are outside this
portable-card correction and retain their existing assets.

Clamped occurrences: FR: 68/72; EN: 67/72.

Evidence directory: /home/antoinefa/src/sentropic/.tmp/governance-unification/cards8-shots/

- reference-measurements.json; baseline-evidence.json; verification.json.
- overview-1920-{fr,en}.png: collapsed overview.
- owner-view-1920-{fr,en}.png: naming-81 expansion state.
- expanded-1920-{fr,en}.png: every frame expanded.
- card-100-1920-{fr,en}.png and card-100-crop-{fr,en}.png: actual 100% zoom.
- reference-overview-1920.png; reference-card-100-1920.png; reference-card-100-crop.png: rendered reference.
- clamped-cards.md: complete FR/EN list.

Portable SHA-256: 792c26925864870151ef13f0df99333f8cff7402c1ad11f3eeefc3a312278b12.

### Clamped card occurrences

Every leaf is 460 × 200 px (reference scale 1:1). Wording is unchanged. Each entry identifies a clamped field and preserves its complete text. Repeated card occurrences are listed by scene.

#### FR

- **central / h2a-focus — Décision → Focus**: card-detail: “DecisionDossierDocument · choix propriétaire”
- **central / h2a-track — Demandes → Track**: card-detail: “Journal append-only · trace demande → production”
- **central / h2a-agent — Agents, sessions et inbox**: service-name: “Agents, sessions et inbox”; card-detail: “Conduite · traitement du feedback · équipement”
- **central / surf-ai — Fournisseurs IA**: card-detail: “Liaisons Cowork / MCP à qualifier par fournisseur”
- **central / surf-cowork — Cowork · poste utilisateur**: service-name: “Cowork · poste utilisateur”; card-detail: “Consentement par action · priorité humaine 60 s · C13”
- **central / surf-cli — CLI · poste développeur**: service-name: “CLI · poste développeur”; card-detail: “Checkout local · sessions sous mandat · C02”
- **central / surf-cloud — Applis tierces et Sentropic**: service-name: “Applis tierces et Sentropic”; card-detail: “Catalogue ↔ instances hébergées · C08/C10”
- **central / cm-apis — 1. API · exposition serveur**: service-name: “1. API · exposition serveur”; card-detail: “Transport et contrats d’accès aux services”
- **central / cm-workflow — 2. Workflows agents**: card-detail: “WorkspaceBindingStore D1=A · moteurs PTY et API”
- **central / mcp-comments — Harnais · outils h2a**: card-detail: “Outils exposés par h2a · annotation via comments · C11”
- **central / mcp-tools — Mémoire, ontologies et UI**: service-name: “Mémoire, ontologies et UI”
- **central / mcp-connectors — Connecteurs à broker**: card-detail: “Notion · Slack · OpenERP · WaveApps · Stripe · …”
- **central / cat-ai — IA · capacités au catalogue**: service-name: “IA · capacités au catalogue”; card-name: “LLM · juge · vision / SAM-YOLO · TTS · STT · …”; card-detail: “LLM mesh / gateway · JEV sur branche · autres familles à qualifier”
- **central / cat-resources — Ressources au catalogue**: service-name: “Ressources au catalogue”; card-detail: “Ontologies · canvas · UI · mémoire · artefacts · C08”
- **central / cat-ui — UI · canvas et apps**: card-detail: “Catalogue UI · MCP / ui:// · artifacts · UI prod”
- **central / store-models — Modèles · sérialisation neutre**: service-name: “Modèles · sérialisation neutre”; card-name: “Transactionnel · analytique · graphe live optimisés”
- **central / store-artifacts — Artefacts · bundles et releases**: service-name: “Artefacts · bundles et releases”; card-name: “@sentropic/artifacts · manifestes SHA-256”; card-detail: “Blobs · canvas / UI · cycle de vie DL-8/13/17 · C10”
- **central / sec-access — Accès et garde des sièges**: service-name: “Accès et garde des sièges”; card-detail: “amr:mfa #695 · garde centrale #596 · C12”
- **central / sec-observe — Observabilité et audit**: card-detail: “Corrélation auditId · soumis / commis / accepté”
- **central / cluster-instances — Liaisons entre instances Sentropic**: service-name: “Liaisons entre instances Sentropic”; card-name: “Contrats et échanges via les surfaces API”; card-detail: “L’API expose ; Cluster intègre les autres instances”
- **central / cluster-infra — Cloud, App Store et registres**: service-name: “Cloud, App Store et registres”; card-detail: “Registres applicatifs · agents · MCP · intégration et déploiement”
- **central / eng-memory — Mémoire, live et agents**: service-name: “Mémoire, live et agents”; card-name: “D3 transactionnel · D1=C analytique · graphe live Git/D10”; card-detail: “Déclare la surface ; sans choix de backend ni pilote DB natif · C05/C06”
- **central / eng-ontologies — Ontologies · WP9**: card-detail: “Profils gouvernés · exports typés · C07/C14”
- **central / ds-diagram — Diagramme**: card-detail: “Gigogne · éditions atomiques · souches JS · C07”
- **annotate / ann-screen — Canvas catalogue & UI en prod**: service-name: “Canvas catalogue & UI en prod”; card-detail: “Contexte tenantId, workspaceId et namespace actif”; repo-label: “Canvas catalogue/MCP & outil @sentropic/annotate”
- **annotate / ann-overlay — N19 · Outil annotate (capture)**: service-name: “N19 · Outil annotate (capture)”; card-detail: “Ancre opaque → modèle Sentropic · G3 actée”; repo-label: “Canvas catalogue/MCP & outil @sentropic/annotate”
- **annotate / ann-mfa — N26 · Auth IdP & 2FA (#695)**: service-name: “N26 · Auth IdP & 2FA (#695)”; card-detail: “Contrôle des droits d’écriture et d’élévation sur le namespace”; repo-label: “Sécurité hôte · 2FA & table de routage”
- **annotate / ann-map — Table destinataire de l’hôte**: service-name: “Table destinataire de l’hôte”; card-name: “Mapping de confiance du build/écran servi”; card-detail: “Interdit toute désignation d’agent depuis le DOM ou l’image”; repo-label: “Sécurité hôte · 2FA & table de routage”
- **annotate / ann-domain — N20 · Modèle unique annotation**: service-name: “N20 · Modèle unique annotation”; card-name: “@sentropic/comments (0.3.0) : ancres & révisions”; card-detail: “Clé composite (tenantId, workspaceId, namespace, kind, id)”; repo-label: “Sentropic · modèle de données unique annotation (@sentropic/comments #684), catalogue & MCP (N20–N21)”
- **annotate / ann-store — Stockage · modèle annotation**: service-name: “Stockage · modèle annotation”; repo-label: “Sentropic · modèle de données unique annotation (@sentropic/comments #684), catalogue & MCP (N20–N21)”
- **annotate / ann-outbox — N21 · Outbox & médiation agent**: service-name: “N21 · Outbox & médiation agent”; card-detail: “Émet un reçu corrélé (auditId) vers le destinataire h2a”; repo-label: “Sentropic · modèle de données unique annotation (@sentropic/comments #684), catalogue & MCP (N20–N21)”
- **annotate / ann-inbox — N21 · Inbox de l’agent responsable**: service-name: “N21 · Inbox de l’agent responsable”; card-detail: “Acquittement de prise en charge dans le workspace lié”; repo-label: “h2a · réception agent, Focus & suivi Track”
- **annotate / ann-track — N22a · Amendement / item @sentropic/track**: service-name: “N22a · Amendement / item @sentropic/track”; card-detail: “Résoudre le fil de commentaire ne clôt jamais l’item Track”; repo-label: “h2a · réception agent, Focus & suivi Track”
- **annotate / ann-capture — N22b · memory_capture / admission**: service-name: “N22b · memory_capture / admission”; card-name: “Demande explicite via les 6 outils MCP gelés”; card-detail: “Soumise aux portes de gouvernance et de périmètre (L5)”; repo-label: “engram · admission éventuelle de leçon”
- **annotate / ann-d3 — Journal canonique D3 & graphe D10**: service-name: “Journal canonique D3 & graphe D10”; card-name: “Admission tracée et révocable (withdraw/forget)”; card-detail: “Zéro fuite inter-namespaces (deny-as-missing)”; repo-label: “engram · admission éventuelle de leçon”
- **ontologies / onto-profiles — N11 · Profils d’ontologie gouvernés**: service-name: “N11 · Profils d’ontologie gouvernés”; card-detail: “Identifiants 100 % anglais · alias de lecture historiques (C-05)”; repo-label: “1. Diagramme = Graphe · engram gardien WP9”
- **ontologies / onto-gigogne — N12 · SemanticDocument gigogne**: service-name: “N12 · SemanticDocument gigogne”; card-name: “Conteneurs ouvrables en sous-graphes liés”; repo-label: “1. Diagramme = Graphe · engram gardien WP9”
- **ontologies / skill-focus — N05 · Skill @sentropic/focus (H-1/H-3)**: service-name: “N05 · Skill @sentropic/focus (H-1/H-3)”; card-name: “Synthèse décisionnelle DecisionDossierDocument”; card-detail: “Rendue par <st-decision-dossier> dans le Design System”; repo-label: “3. Skills de présentation · synthèse par usage”
- **ontologies / skill-ui — N17 · Module MCP ui:// (H-4) & canvas**: service-name: “N17 · Module MCP ui:// (H-4) & canvas”; card-name: “Skills de présentation d’architecture, BPMN et audit”; card-detail: “Exposées via les registres cluster-mesh (Option E)”; repo-label: “3. Skills de présentation · synthèse par usage”
- **ontologies / layout-js — N18 · Algos de layout dans notre JS**: service-name: “N18 · Algos de layout dans notre JS”; card-name: “@sentropic/diagram-canvas (L8) & routing orthogonal”; card-detail: “Sugiyama par couches, placement de labels, couverture ELK”; repo-label: “2. Layout, réactivité atomique & autonomie offline · Design System (nos propres souches JS)”
- **ontologies / layout-atomic — Réactivité & atomicité des éditions**: service-name: “Réactivité & atomicité des éditions”; card-name: “Transactions sur SemanticDocument & ViewDocument”; card-detail: “Recalcul local immédiat · séparation sémantique / géométrie”; repo-label: “2. Layout, réactivité atomique & autonomie offline · Design System (nos propres souches JS)”
- **ontologies / layout-offline — Capacité 100 % offline sans CDN**: service-name: “Capacité 100 % offline sans CDN”; card-name: “Bundles JS embarqués autonomes (Focus, canvas)”; card-detail: “Zéro dépendance CDN externe · JS embarqué (ex. 32 Mo accepté)”; repo-label: “2. Layout, réactivité atomique & autonomie offline · Design System (nos propres souches JS)”
- **ontologies / bpmn-f1 — N13 · Mapping bpmn@1 ↔ bpmn-moddle F1**: service-name: “N13 · Mapping bpmn@1 ↔ bpmn-moddle F1”; card-name: “Préserve extensionElements, xmlns et préfixes xsi”; card-detail: “Aller-retour sans perte · zéro second modèle BPMN”; repo-label: “Continuité BPMN & D2D · zéro second modèle”
- **ontologies / bpmn-c14n — Canonicalisation profile-c14n/2**: service-name: “Canonicalisation profile-c14n/2”; card-name: “Hachage déterministe & watermark côté serveur”; card-detail: “Clé watermark côté serveur hors bundle client”; repo-label: “Continuité BPMN & D2D · zéro second modèle”
- **ontologies / bound-build — Build / Rendu : empreintes SHA-256 locales**: service-name: “Build / Rendu : empreintes SHA-256 locales”; card-name: “Validation et peinture 100 % synchrones et locales”
- **ontologies / bound-runtime — Runtime : outil MCP ontology_call**: service-name: “Runtime : outil MCP ontology_call”; card-name: “Exposé au registre cluster-mesh et au catalogue”; card-detail: “Utilisé par les agents pour requêter et valider les profils”
- **memory / mem-d3 — N07/N08 · Journal canonique D3**: service-name: “N07/N08 · Journal canonique D3”; card-name: “Unique autorité d’admission, retrait et oubli”; card-detail: “6 outils MCP gelés v3.2 : search, get, capture, admit, withdraw, forget”; repo-label: “engram · substrat mémoire D3 & D10 (C05)”
- **memory / mem-d10 — N09 · Graphe filtré D10 (#393)**: service-name: “N09 · Graphe filtré D10 (#393)”; card-name: “Projection .engram/graph.json nettoyée à l’oubli”; card-detail: “Tests de non-résurrection X4 (#372) et purge physique X2/X2b”; repo-label: “engram · substrat mémoire D3 & D10 (C05)”
- **memory / time-center — N32 · Service central des temps (D1=C)**: service-name: “N32 · Service central des temps (D1=C)”; card-name: “Cohortes P50/P80/P95 · 4 horloges · régime config”; card-detail: “Alimenté par les observations CI/CD (#698) et agent-stats”; repo-label: “engram · références de temps D1=C (C14)”
- **memory / time-export — Exports commités repo-knowledge@1**: service-name: “Exports commités repo-knowledge@1”; card-name: “knowledge/manifest.json, ci/timings.json, archi”; card-detail: “Zéro MemoryRef commité dans Git (Clause C-12 / R-05)”; repo-label: “engram · références de temps D1=C (C14)”
- **memory / pipe-685 — Étape 1 (M1) · #685 & stockage #684**: service-name: “Étape 1 (M1) · #685 & stockage #684”; card-name: “Interface DB neutre · 3 surfaces optimisées”; card-detail: “Transactionnel · analytique · graphe live ; identité et périmètre injectés”; repo-label: “Sentropic · ordre d’exécution impératif « Mémoire d’abord » (#685 → L5 → R2/R7a/R3)”
- **memory / pipe-l5 — Étape 2 (M1) · E2/L5 (#697)**: service-name: “Étape 2 (M1) · E2/L5 (#697)”; card-name: “Transactionnel : SQLite (Node 24), puis Postgres”; card-detail: “À qualifier avec les 6 outils MCP v3.2 · deny-as-missing”; repo-label: “Sentropic · ordre d’exécution impératif « Mémoire d’abord » (#685 → L5 → R2/R7a/R3)”
- **memory / pipe-r2 — Étape 3 (M2) · R2 / R7a / R3 catalogue**: service-name: “Étape 3 (M2) · R2 / R7a / R3 catalogue”; card-name: “Exposition au registre MCP & catalogue unifié”; card-detail: “Aucune activation de fournisseur paresseux au lookup”; repo-label: “Sentropic · ordre d’exécution impératif « Mémoire d’abord » (#685 → L5 → R2/R7a/R3)”
- **memory / live-read — N10 · Face lecture G1 / G2 / L9 / L9-H**: service-name: “N10 · Face lecture G1 / G2 / L9 / L9-H”; card-name: “Attribution de lignes (#389), symboles (#390), 20 enquêtes (#391)”; card-detail: “Portage L9-H (#400) fusionné dans @sentropic/engram 0.20.0”; repo-label: “engram-live · connaissance Git & enquêtes (C06)”
- **memory / live-seal — Séparation des diffs privés scellés (#371)**: service-name: “Séparation des diffs privés scellés (#371)”; card-name: “Historique Git commité ≠ brouillons locaux non publiés”; card-detail: “Stockage opéré par cluster-mesh (#664 / #684)”; repo-label: “engram-live · connaissance Git & enquêtes (C06)”
- **memory / h2a-r5 — R5 / R6 · Équipement mémoire en 0.98.8**: service-name: “R5 / R6 · Équipement mémoire en 0.98.8”; card-name: “Adoption volontaire par session/agent autorisé”; card-detail: “Mémoire live par agent = vue scopée, pas silo isolé”; repo-label: “h2a · adoption volontaire & planification (WP8)”
- **memory / h2a-wp8 — N32/N33 · Estimateur WP8 & skill plan**: service-name: “N32/N33 · Estimateur WP8 & skill plan”; card-name: “Combine distributions D1=C, agent-stats et dépendances”; card-detail: “Un pronostic temporel ne saute jamais une porte de revue”; repo-label: “h2a · adoption volontaire & planification (WP8)”
- **traceability / hop-1 — Saut 1 · Demande → Organisation (N03)**: service-name: “Saut 1 · Demande → Organisation (N03)”; card-name: “demand.raised → item.created dans .track/events.jsonl”; card-detail: “Rattaché à un WP · périmètre déclaré (BRANCH.md) & mandat (N01/N02)”; repo-label: “Sauts 1 & 2 · Demande, Organisation et Décision (h2a)”
- **traceability / hop-2 — Saut 2 · Organisation → Décision & Archi (N05)**: service-name: “Saut 2 · Organisation → Décision & Archi (N05)”; card-name: “Dossier Focus + événement decision.select dans Track”; card-detail: “Version du contrat et du profil d’ontologie gouverné applicable”; repo-label: “Sauts 1 & 2 · Demande, Organisation et Décision (h2a)”
- **traceability / hop-3 — Saut 3 · Organisation → Changement code (N10)**: service-name: “Saut 3 · Organisation → Changement code (N10)”; card-name: “Commits base/head/merged & faits Git engram-live”; card-detail: “Conserve aussi la trace des PRs fermées ou remplacées”; repo-label: “Sauts 3 & 4 · Code et Qualification (Git / harness)”
- **traceability / hop-4 — Saut 4 · Changement → Qualification (N04)**: service-name: “Saut 4 · Changement → Qualification (N04)”; card-name: “VerificationRun @sentropic/harness & revues ≥ 2 pairs”; card-detail: “Exécuté sur ENV=test-* / e2e-* · « non qualifié » sans couleur”; repo-label: “Sauts 3 & 4 · Code et Qualification (Git / harness)”
- **traceability / hop-5 — Saut 5 · Qualification → Release (N23)**: service-name: “Saut 5 · Qualification → Release (N23)”; card-name: “CanonicalManifest @sentropic/artifacts (0.1.1)”; card-detail: “Empreinte SHA-256 immuable, provenance de build et canal”; repo-label: “Sauts 5 & 6 · Release scellée et Mise en production (Sentropic & opérateur)”
- **traceability / hop-6 — Saut 6 · Release → Production (N31)**: service-name: “Saut 6 · Release → Production (N31)”; card-name: “Reçu d’installation/déploiement par environnement”; card-detail: “Vérification de santé & cible de rollback (fusion ≠ installation)”; repo-label: “Sauts 5 & 6 · Release scellée et Mise en production (Sentropic & opérateur)”
- **traceability / hop-corr — Corrélation & états d’exécution (N33)**: service-name: “Corrélation & états d’exécution (N33)”; card-name: “Clés auditId / correlationId de bout en bout”; card-detail: “Sépare soumis, commis, visible et accepté (Clause C-10)”; repo-label: “Sauts 5 & 6 · Release scellée et Mise en production (Sentropic & opérateur)”
- **traceability / hop-7a — Saut 7a · Acceptation propriétaire (Track)**: service-name: “Saut 7a · Acceptation propriétaire (Track)”; card-name: “État acceptance (pass/fail/waived/stale) distinct de done”; card-detail: “Enregistré après vérification sur l’environnement réel”; repo-label: “Saut 7 · Acceptation & adoption aval (h2a / apps)”
- **traceability / hop-7b — Saut 7b · Adoption aval (ds-history)**: service-name: “Saut 7b · Adoption aval (ds-history)”; card-name: “Publier un package ≠ adopter dans l’application”; card-detail: “Les 8 sujets historiques conservent leur suivi d’adoption”; repo-label: “Saut 7 · Acceptation & adoption aval (h2a / apps)”
- **traceability / loop-mem — Admission de leçon (D3) si pertinent**: service-name: “Admission de leçon (D3) si pertinent”; card-name: “Capture explicite rattachée au périmètre autorisé”; card-detail: “Aucun MemoryRef injecté dans les artefacts Git”; repo-label: “Boucle de retour · Mémoire & Temps (engram)”
- **traceability / loop-time — Retour prédit vs réel vers D1=C (N32)**: service-name: “Retour prédit vs réel vers D1=C (N32)”; card-name: “Recalibre les distributions par phase et régime”; card-detail: “Améliore l’estimateur WP8 sans réduire les portes qualité”; repo-label: “Boucle de retour · Mémoire & Temps (engram)”

#### EN

- **central / h2a-track — Requests → Track**: card-detail: “Append-only log · request → production trace”
- **central / h2a-agent — Agents, sessions and inbox**: service-name: “Agents, sessions and inbox”
- **central / surf-ai — AI providers**: card-detail: “Cowork / MCP connections to qualify per provider”
- **central / surf-cowork — Cowork · user workstation**: service-name: “Cowork · user workstation”; card-detail: “Consent per action · human priority 60 s · C13”
- **central / surf-cli — CLI · developer workstation**: service-name: “CLI · developer workstation”; card-detail: “Local checkout · mandated sessions · C02”
- **central / surf-cloud — Third-party and Sentropic apps**: service-name: “Third-party and Sentropic apps”; card-detail: “Catalogue ↔ hosted instances · C08/C10”
- **central / cm-apis — 1. API · server exposure**: service-name: “1. API · server exposure”
- **central / cm-workflow — 2. Agent workflows**: card-detail: “WorkspaceBindingStore D1=A · PTY and API engines”
- **central / mcp-comments — Harness · h2a tools**: card-detail: “Tools exposed by h2a · annotation via comments · C11”
- **central / mcp-tools — Memory, ontologies and UI**: service-name: “Memory, ontologies and UI”
- **central / mcp-connectors — Connectors to broker**: card-detail: “Notion · Slack · OpenERP · WaveApps · Stripe · …”
- **central / cat-ai — AI · catalogue capabilities**: service-name: “AI · catalogue capabilities”; card-name: “LLM · judge · vision / SAM-YOLO · TTS · STT · …”; card-detail: “LLM mesh / gateway · JEV on branch · other families to qualify”
- **central / cat-resources — Catalogue resources**: card-detail: “Ontologies · canvases · UI · memory · artifacts · C08”
- **central / cat-ui — UI · canvases and apps**: service-name: “UI · canvases and apps”; card-detail: “UI catalogue · MCP / ui:// · artifacts · production UI”
- **central / store-models — Models · neutral serialization**: service-name: “Models · neutral serialization”; card-name: “Optimised transactional, analytical and live graph surfaces”
- **central / store-artifacts — Artifacts · bundles and releases**: service-name: “Artifacts · bundles and releases”; card-name: “@sentropic/artifacts · SHA-256 manifests”; card-detail: “Blobs · canvases / UI · DL-8/13/17 lifecycle · C10”
- **central / sec-access — Access and seat custody**: service-name: “Access and seat custody”; card-detail: “amr:mfa #695 · central custody #596 · C12”
- **central / sec-observe — Observability and audit**: service-name: “Observability and audit”; card-detail: “auditId correlation · submitted / committed / accepted”
- **central / cluster-instances — Connections between Sentropic instances**: service-name: “Connections between Sentropic instances”; card-name: “Contracts and exchanges through API surfaces”; card-detail: “API exposes; Cluster integrates other instances”
- **central / cluster-infra — Cloud, App Store and registries**: service-name: “Cloud, App Store and registries”; card-detail: “Application · agent · MCP registries · integration and deployment”
- **central / eng-memory — Memory, live and agents**: service-name: “Memory, live and agents”; card-name: “D3 transactional · D1=C analytical · Git/D10 live graph”; card-detail: “Declares the surface; no backend choice or native DB driver · C05/C06”
- **central / eng-ontologies — Ontologies · WP9**: card-detail: “Governed profiles · typed exports · C07/C14”
- **central / ds-diagram — Diagram**: card-detail: “Nested views · atomic edits · JS foundations · C07”
- **annotate / ann-screen — Catalogue canvases & production UI**: service-name: “Catalogue canvases & production UI”; card-detail: “Active tenantId, workspaceId and namespace context”; repo-label: “Catalogue/MCP canvases & @sentropic/annotate tool”
- **annotate / ann-overlay — N19 · annotate tool (capture)**: service-name: “N19 · annotate tool (capture)”; card-detail: “Opaque anchor → Sentropic model · G3 settled”; repo-label: “Catalogue/MCP canvases & @sentropic/annotate tool”
- **annotate / ann-mfa — N26 · Auth IdP & 2FA (#695)**: service-name: “N26 · Auth IdP & 2FA (#695)”; card-detail: “Checks write and elevation permissions in the namespace”
- **annotate / ann-map — Host recipient table**: card-name: “Trusted mapping from the served build/screen”; card-detail: “Forbids selecting agents from the DOM or image”
- **annotate / ann-domain — N20 · Single annotation model**: service-name: “N20 · Single annotation model”; card-name: “@sentropic/comments (0.3.0): anchors & revisions”; card-detail: “Composite key (tenantId, workspaceId, namespace, kind, id)”; repo-label: “Sentropic · single annotation data model (@sentropic/comments #684), catalogue & MCP (N20–N21)”
- **annotate / ann-store — Storage · annotation model**: service-name: “Storage · annotation model”; repo-label: “Sentropic · single annotation data model (@sentropic/comments #684), catalogue & MCP (N20–N21)”
- **annotate / ann-outbox — N21 · Outbox & agent mediation**: service-name: “N21 · Outbox & agent mediation”; card-detail: “Emits a correlated receipt (auditId) to the h2a recipient”; repo-label: “Sentropic · single annotation data model (@sentropic/comments #684), catalogue & MCP (N20–N21)”
- **annotate / ann-inbox — N21 · Responsible agent’s inbox**: service-name: “N21 · Responsible agent’s inbox”; card-detail: “Acknowledgement in the bound workspace”; repo-label: “h2a · agent delivery, Focus & Track follow-up”
- **annotate / ann-track — N22a · Amendment / @sentropic/track item**: service-name: “N22a · Amendment / @sentropic/track item”; card-name: “Explicit creation of an item linked to the annotation”; card-detail: “Resolving a comment thread never closes the Track item”; repo-label: “h2a · agent delivery, Focus & Track follow-up”
- **annotate / ann-capture — N22b · memory_capture / admission**: service-name: “N22b · memory_capture / admission”; card-name: “Explicit request through the six frozen MCP tools”; card-detail: “Subject to governance and scope gates (L5)”
- **annotate / ann-d3 — Canonical D3 log & D10 graph**: service-name: “Canonical D3 log & D10 graph”; card-name: “Traceable, revocable admission (withdraw/forget)”; card-detail: “No cross-namespace leakage (deny-as-missing)”
- **ontologies / onto-profiles — N11 · Governed ontology profiles**: service-name: “N11 · Governed ontology profiles”; card-detail: “100% English identifiers · historical read aliases (C-05)”; repo-label: “1. Diagram = Graph · Engram as WP9 custodian”
- **ontologies / onto-gigogne — N12 · Nested SemanticDocument**: service-name: “N12 · Nested SemanticDocument”; card-detail: “DS executor · Engram profiles · G2 settled”; repo-label: “1. Diagram = Graph · Engram as WP9 custodian”
- **ontologies / skill-focus — N05 · @sentropic/focus skill (H-1/H-3)**: service-name: “N05 · @sentropic/focus skill (H-1/H-3)”; card-name: “Decision synthesis: DecisionDossierDocument”; card-detail: “Rendered by <st-decision-dossier> in Design System”; repo-label: “3. Presentation skills · synthesis by use case”
- **ontologies / skill-ui — N17 · MCP ui:// module (H-4) & canvases**: service-name: “N17 · MCP ui:// module (H-4) & canvases”; card-name: “Architecture, BPMN and audit presentation skills”; card-detail: “Exposed through cluster-mesh registries (Option E)”; repo-label: “3. Presentation skills · synthesis by use case”
- **ontologies / layout-js — N18 · Layout algorithms in our JS**: service-name: “N18 · Layout algorithms in our JS”; card-name: “@sentropic/diagram-canvas (L8) & orthogonal routing”; card-detail: “Layered Sugiyama, label placement, ELK coverage”; repo-label: “2. Layout, atomic responsiveness & offline autonomy · Design System (our own JS codebases)”
- **ontologies / layout-atomic — Responsive & atomic edits**: service-name: “Responsive & atomic edits”; card-name: “Transactions on SemanticDocument & ViewDocument”; card-detail: “Immediate local recomputation · semantics / geometry separation”; repo-label: “2. Layout, atomic responsiveness & offline autonomy · Design System (our own JS codebases)”
- **ontologies / layout-offline — 100% offline capability without a CDN**: service-name: “100% offline capability without a CDN”; card-name: “Standalone embedded JS bundles (Focus, canvases)”; card-detail: “No external CDN dependency · embedded JS (e.g. 32 MB accepted)”; repo-label: “2. Layout, atomic responsiveness & offline autonomy · Design System (our own JS codebases)”
- **ontologies / bpmn-f1 — N13 · bpmn@1 ↔ bpmn-moddle F1 mapping**: service-name: “N13 · bpmn@1 ↔ bpmn-moddle F1 mapping”; card-name: “Preserves extensionElements, xmlns and xsi prefixes”; card-detail: “Lossless round trip · no second BPMN model”; repo-label: “BPMN & D2D continuity · no second model”
- **ontologies / bpmn-c14n — profile-c14n/2 canonicalisation**: service-name: “profile-c14n/2 canonicalisation”; card-name: “Deterministic hashing & server-side watermark”; card-detail: “Server-side watermark key excluded from client bundle”; repo-label: “BPMN & D2D continuity · no second model”
- **ontologies / bound-build — Build / Render: local SHA-256 fingerprints**: service-name: “Build / Render: local SHA-256 fingerprints”; card-name: “Fully synchronous, local validation and painting”
- **ontologies / bound-runtime — Runtime: ontology_call MCP tool**: service-name: “Runtime: ontology_call MCP tool”; card-name: “Exposed in the cluster-mesh registry and catalogue”; card-detail: “Used by agents to query and validate profiles”
- **memory / mem-d3 — N07/N08 · Canonical D3 log**: service-name: “N07/N08 · Canonical D3 log”; card-name: “Sole authority for admission, withdrawal and forgetting”; card-detail: “Six frozen MCP tools v3.2: search, get, capture, admit, withdraw, forget”; repo-label: “Engram · D3 & D10 memory substrate (C05)”
- **memory / mem-d10 — N09 · Filtered D10 graph (#393)**: service-name: “N09 · Filtered D10 graph (#393)”; card-name: “.engram/graph.json projection cleaned on forgetting”; card-detail: “Non-resurrection tests X4 (#372) and physical purge X2/X2b”; repo-label: “Engram · D3 & D10 memory substrate (C05)”
- **memory / time-center — N32 · Central timing service (D1=C)**: service-name: “N32 · Central timing service (D1=C)”; card-name: “P50/P80/P95 cohorts · four clocks · configuration regime”; card-detail: “Fed by CI/CD observations (#698) and agent-stats”; repo-label: “Engram · D1=C timing references (C14)”
- **memory / time-export — Committed repo-knowledge@1 exports**: service-name: “Committed repo-knowledge@1 exports”; card-name: “knowledge/manifest.json, ci/timings.json, archi”; card-detail: “No MemoryRef committed to Git (Clause C-12 / R-05)”; repo-label: “Engram · D1=C timing references (C14)”
- **memory / pipe-685 — Step 1 (M1) · #685 & storage #684**: service-name: “Step 1 (M1) · #685 & storage #684”; card-name: “Neutral DB interface · three optimised surfaces”; card-detail: “Transactional · analytical · live graph; injected identity and scope”; repo-label: “Sentropic · mandatory memory-first execution order (#685 → L5 → R2/R7a/R3)”
- **memory / pipe-l5 — Step 2 (M1) · E2/L5 (#697)**: service-name: “Step 2 (M1) · E2/L5 (#697)”; card-name: “Transactional: SQLite (Node 24), then Postgres”; card-detail: “Qualification with six MCP v3.2 tools pending · deny-as-missing”; repo-label: “Sentropic · mandatory memory-first execution order (#685 → L5 → R2/R7a/R3)”
- **memory / pipe-r2 — Step 3 (M2) · R2 / R7a / R3 catalogue**: service-name: “Step 3 (M2) · R2 / R7a / R3 catalogue”; card-name: “Exposure through MCP registry & unified catalogue”; repo-label: “Sentropic · mandatory memory-first execution order (#685 → L5 → R2/R7a/R3)”
- **memory / live-read — N10 · Read surface G1 / G2 / L9 / L9-H**: service-name: “N10 · Read surface G1 / G2 / L9 / L9-H”; card-name: “Line attribution (#389), symbols (#390), 20 investigations (#391)”; card-detail: “L9-H port (#400) merged in @sentropic/engram 0.20.0”; repo-label: “engram-live · Git knowledge & investigations (C06)”
- **memory / live-seal — Separate sealed private diffs (#371)**: service-name: “Separate sealed private diffs (#371)”; card-name: “Committed Git history ≠ unpublished local drafts”; card-detail: “Storage operated by cluster-mesh (#664 / #684)”; repo-label: “engram-live · Git knowledge & investigations (C06)”
- **memory / h2a-r5 — R5 / R6 · Memory equipment in 0.98.8**: service-name: “R5 / R6 · Memory equipment in 0.98.8”; card-name: “Voluntary adoption by authorised session/agent”; card-detail: “Live memory per agent = scoped view, not an isolated silo”; repo-label: “h2a · voluntary adoption & planning (WP8)”
- **memory / h2a-wp8 — N32/N33 · WP8 estimator & plan skill**: service-name: “N32/N33 · WP8 estimator & plan skill”; card-name: “Combines D1=C distributions, agent-stats and dependencies”; card-detail: “A time forecast never bypasses a review gate”; repo-label: “h2a · voluntary adoption & planning (WP8)”
- **traceability / hop-1 — Hop 1 · Request → Organisation (N03)**: service-name: “Hop 1 · Request → Organisation (N03)”; card-name: “demand.raised → item.created in .track/events.jsonl”; card-detail: “Linked to a WP · declared scope (BRANCH.md) & mandate (N01/N02)”; repo-label: “Hops 1 & 2 · Request, Organisation and Decision (h2a)”
- **traceability / hop-2 — Hop 2 · Organisation → Decision & Architecture (N05)**: service-name: “Hop 2 · Organisation → Decision & Architecture (N05)”; card-name: “Focus dossier + decision.select event in Track”; card-detail: “Applicable contract and governed ontology profile version”; repo-label: “Hops 1 & 2 · Request, Organisation and Decision (h2a)”
- **traceability / hop-3 — Hop 3 · Organisation → Code change (N10)**: service-name: “Hop 3 · Organisation → Code change (N10)”; card-name: “base/head/merged commits & engram-live Git facts”; card-detail: “Also retains records of closed or superseded PRs”; repo-label: “Hops 3 & 4 · Code and Qualification (Git / harness)”
- **traceability / hop-4 — Hop 4 · Change → Qualification (N04)**: service-name: “Hop 4 · Change → Qualification (N04)”; card-name: “@sentropic/harness VerificationRun & reviews by ≥ 2 peers”; card-detail: “Run on ENV=test-* / e2e-* · unqualified without colour”; repo-label: “Hops 3 & 4 · Code and Qualification (Git / harness)”
- **traceability / hop-5 — Hop 5 · Qualification → Release (N23)**: service-name: “Hop 5 · Qualification → Release (N23)”; card-name: “@sentropic/artifacts CanonicalManifest (0.1.1)”; card-detail: “Immutable SHA-256 fingerprint, build provenance and channel”; repo-label: “Hops 5 & 6 · Sealed release and Production deployment (Sentropic & operator)”
- **traceability / hop-6 — Hop 6 · Release → Production (N31)**: service-name: “Hop 6 · Release → Production (N31)”; card-name: “Installation/deployment receipt per environment”; card-detail: “Health check & rollback target (merge ≠ installation)”; repo-label: “Hops 5 & 6 · Sealed release and Production deployment (Sentropic & operator)”
- **traceability / hop-corr — Correlation & execution states (N33)**: service-name: “Correlation & execution states (N33)”; card-detail: “Separates submitted, committed, visible and accepted (Clause C-10)”; repo-label: “Hops 5 & 6 · Sealed release and Production deployment (Sentropic & operator)”
- **traceability / hop-7a — Hop 7a · Owner acceptance (Track)**: service-name: “Hop 7a · Owner acceptance (Track)”; card-name: “acceptance state (pass/fail/waived/stale) separate from done”; card-detail: “Recorded after verification in the actual environment”; repo-label: “Hop 7 · Acceptance & downstream adoption (h2a / apps)”
- **traceability / hop-7b — Hop 7b · Downstream adoption (ds-history)**: service-name: “Hop 7b · Downstream adoption (ds-history)”; card-name: “Publishing a package ≠ adopting it in the application”; card-detail: “All eight historical topics retain their adoption tracking”; repo-label: “Hop 7 · Acceptance & downstream adoption (h2a / apps)”
- **traceability / loop-mem — Lesson admission (D3), where relevant**: service-name: “Lesson admission (D3), where relevant”; card-name: “Explicit capture linked to the authorised scope”; repo-label: “Feedback loop · Memory & Time (Engram)”
- **traceability / loop-time — Predicted vs actual feedback to D1=C (N32)**: service-name: “Predicted vs actual feedback to D1=C (N32)”; card-name: “Recalibrates distributions by phase and regime”; card-detail: “Improves the WP8 estimator without reducing quality gates”; repo-label: “Feedback loop · Memory & Time (Engram)”

## Owner catalogue content corrections — 2026-10-20

Baseline: cards-8 commit d022eca3d, pulled from docs/governance-contract. All of cards-8 is retained: 460 × 200 leaves, fonts, slots, clamps, styles, borders, 1px rules, footers and collapsed frame dimensions. Only the requested content/icons and collapsed overview positions change.

Icons: AI uses **BrainCircuit** (brain-circuit); Agent catalog uses **Bot** (bot). Both are unmodified @lucide/svelte 0.562.0 SVG nodes, the icon dependency of the installed DS. allcards.mjs compares the rendered nodes with the installed package; no custom geometry or new dependency is used.

Removed Agent catalog items: UI and canvas/canvases already appear in UI · canvas et apps / UI · canvases and apps; ontologies already appear in Engram's Ontologies · WP9; memory already appears in Engram's Mémoire, live et agents / Memory, live and agents. Skills, tools, agents, workflows, apps, artefacts/artifacts and C08 remain. Their catalogue descriptors are distinct from runtime tools/workflows, UI rendering and storage hosting; the cat-resources → store-artifacts relationship already names references/hosting.

The memory MCP card now contains only memory and ontology items. Track and Focus were already present once in the h2a tools card; they were removed from the memory card without being added a second time to h2a.

| h2a text slot | FR before = after | EN before = after |
| --- | --- | --- |
| Title | Harnais · outils h2a | Harness · h2a tools |
| Function | annotate · Track · Focus · sessions · … | annotate · Track · Focus · sessions · … |
| Detail | Outils exposés par h2a · annotation via comments · C11 | Tools exposed by h2a · annotation via comments · C11 |

Every changed FR/EN string is listed below, including complete route paragraphs. These replacements propagate through the source card data, translation dictionary, dossier route prose, generated presentation/summary data, diagrams, chips, tabs and portable text. The EN Engram title remains Engram · Curated Knowledge. Owner quotations remain verbatim.

| FR before | FR after | EN before | EN after |
| --- | --- | --- | --- |
| Mémoire, ontologies et UI | Mémoires et ontologies | Memory, ontologies and UI | Memories and ontologies |
| 6 outils mémoire · ontology_call · ui:// | 6 outils mémoire · ontology_call | 6 memory tools · ontology_call · ui:// | 6 memory tools · ontology_call |
| h2a / Track / Focus · connecteurs MCP | Contrats mémoire et ontologies | h2a / Track / Focus · MCP connectors | Memory and ontology contracts |
| Ressources au catalogue | Catalogue Agents | Catalogue resources | Agent catalog |
| Ontologies · canvas · UI · mémoire · artefacts · C08 | Artefacts · C08 | Ontologies · canvases · UI · memory · artifacts · C08 | Artifacts · C08 |
| Engram · Savoir curé | Engram · Connaissances qualifiées | Engram · Curated Knowledge | Engram · Curated Knowledge |

### Measured alignment at 1920 × 1080

Before: overview h2a/Surfaces top-y deviation **48 px**, Engram/Design System **140 px**, both FR and EN. Heights already matched (272 px). The two columns' vertical gaps were 340 and 248 px (92 px difference). After: row top-y and height deviations **0 px**, both columns have the same x within the column and a **388 px** vertical gap (0 px difference). The overview fix changes positions only; endpoint banks and named edge contracts remain unchanged, and routes/labels follow their frames.

Before and after: all expanded card row-y, column-x, vertical-gap and neighbouring frame top-y/height deviations are **0 px**. Leaf columns retain 72 px gaps. All 144 scene/locale leaf occurrences measure **460 × 200**. At actual 1:1 scale the CSS separator is y=152.5625 px, height 1 px; footer top is y=157.5625 px. Both have exactly 0 px deviation across all 144 occurrences. The visible SVG rule is y=153.1 px relative to the card, non-scaling 1px stroke. At fitted overview scale in expanded views, screenshot pixel comparisons with rules hidden confirm visibility along >95% of every usable rule width. Screen-to-SVG footer conversion has <0.001 px floating point noise; all numbers below are rounded to 0.001 px.

| Locale/state | Leaves | Size deviation | Rule y | Footer y | Row y | Column x | Gap | Frame y | Frame height |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FR overview | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| FR expanded | 28 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| FR catalogs | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| EN overview | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| EN expanded | 28 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| EN catalogs | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Fully expanded before/after leaf and frame geometry is identical. Edge IDs, endpoints, classes, labels and styles are retained in overview, expanded and Catalogs states. Mixed expanded/collapsed frames in the focused Catalogs view retain their respective approved sizes; row-height comparisons apply to the requested overview and all-expanded states.

Checks: source integrity/translations; 102 geometry scenes / 732 edges with zero violations; 16 offline browser configurations / 328 interactions; 32 slides / 52 need views; all 144 rendered leaves; installed Lucide geometry; FR/EN 1920px before/after and visible-rule pixel comparisons. No Python or persistent services used.

Evidence: /home/antoinefa/src/sentropic/.tmp/governance-unification/content9-shots/

- catalog-focus-1920-fr.png and catalog-focus-1920-en.png: expanded Catalogs zone, all three MCP tools cards included.
- catalogs-1920-{fr,en}.png: Catalogs in its surrounding architecture.
- overview-1920-{fr,en}.png and expanded-1920-{fr,en}.png.
- before.html, verification.json, allcards.json, strings.json and reproducible probe/edit/report scripts.

Portable SHA-256: 2979ea7a9fcdd7f650087e0571d9c47a6473cac0a5b34765ce4d35fca25eb86e.

### Full route string replacements

#### Route text 1

FR before: 9. Canvas UI & Focus (Option E) · Relations du parcours : Décision → Focus → Dossier de décision (schéma et skill) ; Dossier de décision → Diagramme (diagramme central) ; Dossier de décision → Annotations · annotate (feedback) ; Diagramme → 200+ composants UI (rendu UI) ; 200+ composants UI → UI · canvas et apps (descripteurs canvas / UI) ; UI · canvas et apps → Ressources au catalogue (catalogue logique) ; UI · canvas et apps → Artefacts · bundles et releases (hébergement UI / apps) ; Ressources au catalogue → Artefacts · bundles et releases (références / hébergement) ; UI · canvas et apps → Mémoire, ontologies et UI (liaison MCP / ui://).

FR after: 9. Canvas UI & Focus (Option E) · Relations du parcours : Décision → Focus → Dossier de décision (schéma et skill) ; Dossier de décision → Diagramme (diagramme central) ; Dossier de décision → Annotations · annotate (feedback) ; Diagramme → 200+ composants UI (rendu UI) ; 200+ composants UI → UI · canvas et apps (descripteurs canvas / UI) ; UI · canvas et apps → Catalogue Agents (catalogue logique) ; UI · canvas et apps → Artefacts · bundles et releases (hébergement UI / apps) ; Catalogue Agents → Artefacts · bundles et releases (références / hébergement) ; UI · canvas et apps → Mémoires et ontologies (liaison MCP / ui://).

EN before: 9. UI canvases & Focus (Option E) · Route relationships: Decision → Focus → Decision dossier (schema and skill); Decision dossier → Diagram (central diagram); Decision dossier → Annotations · annotate (feedback); Diagram → 200+ UI components (UI rendering); 200+ UI components → UI · canvases and apps (canvas / UI descriptors); UI · canvases and apps → Catalogue resources (logical catalogue); UI · canvases and apps → Artifacts · bundles and releases (UI / app hosting); Catalogue resources → Artifacts · bundles and releases (references / hosting); UI · canvases and apps → Memory, ontologies and UI (MCP / ui:// connection).

EN after: 9. UI canvases & Focus (Option E) · Route relationships: Decision → Focus → Decision dossier (schema and skill); Decision dossier → Diagram (central diagram); Decision dossier → Annotations · annotate (feedback); Diagram → 200+ UI components (UI rendering); 200+ UI components → UI · canvases and apps (canvas / UI descriptors); UI · canvases and apps → Agent catalog (logical catalogue); UI · canvases and apps → Artifacts · bundles and releases (UI / app hosting); Agent catalog → Artifacts · bundles and releases (references / hosting); UI · canvases and apps → Memories and ontologies (MCP / ui:// connection).

#### Route text 2

FR before: 4. Mémoire agentique & live · Relations du parcours : Mémoire, live et agents → Mémoire, ontologies et UI (contrats mémoire) ; Mémoire, live et agents → Modèles · sérialisation neutre (déclare la surface) ; 2. Workflows agents → Modèles · sérialisation neutre (états de session) ; 2. Workflows agents → Agents, sessions et inbox (inbox et reçus) ; 1. API · exposition serveur → 2. Workflows agents (appels) ; 1. API · exposition serveur → Accès et garde des sièges (autorisation).

FR after: 4. Mémoire agentique & live · Relations du parcours : Mémoire, live et agents → Mémoires et ontologies (contrats mémoire) ; Mémoire, live et agents → Modèles · sérialisation neutre (déclare la surface) ; 2. Workflows agents → Modèles · sérialisation neutre (états de session) ; 2. Workflows agents → Agents, sessions et inbox (inbox et reçus) ; 1. API · exposition serveur → 2. Workflows agents (appels) ; 1. API · exposition serveur → Accès et garde des sièges (autorisation).

EN before: 4. Agentic & live memory · Route relationships: Memory, live and agents → Memory, ontologies and UI (memory contracts); Memory, live and agents → Models · neutral serialization (declares surface); 2. Agent workflows → Models · neutral serialization (session states); 2. Agent workflows → Agents, sessions and inbox (inbox and receipts); 1. API · server exposure → 2. Agent workflows (calls); 1. API · server exposure → Access and seat custody (authorisation).

EN after: 4. Agentic & live memory · Route relationships: Memory, live and agents → Memories and ontologies (memory contracts); Memory, live and agents → Models · neutral serialization (declares surface); 2. Agent workflows → Models · neutral serialization (session states); 2. Agent workflows → Agents, sessions and inbox (inbox and receipts); 1. API · server exposure → 2. Agent workflows (calls); 1. API · server exposure → Access and seat custody (authorisation).

#### Route text 3

FR before: 3. Ontologies (WP9) · Relations du parcours : Ontologies · WP9 → Mémoire, ontologies et UI (contrats ontologies) ; Ontologies · WP9 → Diagramme (profils épinglés) ; 1. API · exposition serveur → Mémoire, ontologies et UI (expose les MCP).

FR after: 3. Ontologies (WP9) · Relations du parcours : Ontologies · WP9 → Mémoires et ontologies (contrats ontologies) ; Ontologies · WP9 → Diagramme (profils épinglés) ; 1. API · exposition serveur → Mémoires et ontologies (expose les MCP).

EN before: 3. Ontologies (WP9) · Route relationships: Ontologies · WP9 → Memory, ontologies and UI (ontology contracts); Ontologies · WP9 → Diagram (pinned profiles); 1. API · server exposure → Memory, ontologies and UI (exposes MCP tools).

EN after: 3. Ontologies (WP9) · Route relationships: Ontologies · WP9 → Memories and ontologies (ontology contracts); Ontologies · WP9 → Diagram (pinned profiles); 1. API · server exposure → Memories and ontologies (exposes MCP tools).

#### Route text 4

FR before: 2. Catalogue · MCP, IA & ressources · Relations du parcours : 1. API · exposition serveur → Mémoire, ontologies et UI (expose les MCP) ; 1. API · exposition serveur → Harnais · outils h2a (expose le harnais MCP) ; 1. API · exposition serveur → Connecteurs à broker (broker MCP) ; 1. API · exposition serveur → IA · capacités au catalogue (expose les IA) ; 1. API · exposition serveur → Ressources au catalogue (expose le catalogue) ; Mémoire, live et agents → Mémoire, ontologies et UI (contrats mémoire) ; Ontologies · WP9 → Mémoire, ontologies et UI (contrats ontologies) ; Ressources au catalogue → Artefacts · bundles et releases (références / hébergement) ; Applis tierces et Sentropic → Ressources au catalogue (synchronise le catalogue) ; UI · canvas et apps → Ressources au catalogue (catalogue logique).

FR after: 2. Catalogue · MCP, IA & ressources · Relations du parcours : 1. API · exposition serveur → Mémoires et ontologies (expose les MCP) ; 1. API · exposition serveur → Harnais · outils h2a (expose le harnais MCP) ; 1. API · exposition serveur → Connecteurs à broker (broker MCP) ; 1. API · exposition serveur → IA · capacités au catalogue (expose les IA) ; 1. API · exposition serveur → Catalogue Agents (expose le catalogue) ; Mémoire, live et agents → Mémoires et ontologies (contrats mémoire) ; Ontologies · WP9 → Mémoires et ontologies (contrats ontologies) ; Catalogue Agents → Artefacts · bundles et releases (références / hébergement) ; Applis tierces et Sentropic → Catalogue Agents (synchronise le catalogue) ; UI · canvas et apps → Catalogue Agents (catalogue logique).

EN before: 2. Catalogue · MCP, AI & resources · Route relationships: 1. API · server exposure → Memory, ontologies and UI (exposes MCP tools); 1. API · server exposure → Harness · h2a tools (exposes MCP harness); 1. API · server exposure → Connectors to broker (MCP broker); 1. API · server exposure → AI · catalogue capabilities (exposes AI); 1. API · server exposure → Catalogue resources (exposes catalogue); Memory, live and agents → Memory, ontologies and UI (memory contracts); Ontologies · WP9 → Memory, ontologies and UI (ontology contracts); Catalogue resources → Artifacts · bundles and releases (references / hosting); Third-party and Sentropic apps → Catalogue resources (syncs catalogue); UI · canvases and apps → Catalogue resources (logical catalogue).

EN after: 2. Catalogue · MCP, AI & resources · Route relationships: 1. API · server exposure → Memories and ontologies (exposes MCP tools); 1. API · server exposure → Harness · h2a tools (exposes MCP harness); 1. API · server exposure → Connectors to broker (MCP broker); 1. API · server exposure → AI · catalogue capabilities (exposes AI); 1. API · server exposure → Agent catalog (exposes catalogue); Memory, live and agents → Memories and ontologies (memory contracts); Ontologies · WP9 → Memories and ontologies (ontology contracts); Agent catalog → Artifacts · bundles and releases (references / hosting); Third-party and Sentropic apps → Agent catalog (syncs catalogue); UI · canvases and apps → Agent catalog (logical catalogue).

#### Route text 5

FR before: 10. Modèles & artefacts (#684) · Relations du parcours : Diagramme → Modèles · sérialisation neutre (sérialisation neutre) ; Diagramme → 200+ composants UI (rendu UI) ; 200+ composants UI → UI · canvas et apps (descripteurs canvas / UI) ; UI · canvas et apps → Artefacts · bundles et releases (hébergement UI / apps) ; Ressources au catalogue → Artefacts · bundles et releases (références / hébergement) ; Harnais · outils h2a → Modèles · sérialisation neutre (persiste annotation) ; Mémoire, live et agents → Modèles · sérialisation neutre (déclare la surface).

FR after: 10. Modèles & artefacts (#684) · Relations du parcours : Diagramme → Modèles · sérialisation neutre (sérialisation neutre) ; Diagramme → 200+ composants UI (rendu UI) ; 200+ composants UI → UI · canvas et apps (descripteurs canvas / UI) ; UI · canvas et apps → Artefacts · bundles et releases (hébergement UI / apps) ; Catalogue Agents → Artefacts · bundles et releases (références / hébergement) ; Harnais · outils h2a → Modèles · sérialisation neutre (persiste annotation) ; Mémoire, live et agents → Modèles · sérialisation neutre (déclare la surface).

EN before: 10. Models & artifacts (#684) · Route relationships: Diagram → Models · neutral serialization (neutral serialization); Diagram → 200+ UI components (UI rendering); 200+ UI components → UI · canvases and apps (canvas / UI descriptors); UI · canvases and apps → Artifacts · bundles and releases (UI / app hosting); Catalogue resources → Artifacts · bundles and releases (references / hosting); Harness · h2a tools → Models · neutral serialization (persists annotation); Memory, live and agents → Models · neutral serialization (declares surface).

EN after: 10. Models & artifacts (#684) · Route relationships: Diagram → Models · neutral serialization (neutral serialization); Diagram → 200+ UI components (UI rendering); 200+ UI components → UI · canvases and apps (canvas / UI descriptors); UI · canvases and apps → Artifacts · bundles and releases (UI / app hosting); Agent catalog → Artifacts · bundles and releases (references / hosting); Harness · h2a tools → Models · neutral serialization (persists annotation); Memory, live and agents → Models · neutral serialization (declares surface).

## Mixed-fold click latency (main integration follow-up)

Only conflict: BRANCH.md add/add from PR #712. Retained the governance branch plan and all incoming main implementation/CI changes; .track is unchanged. Merge commit: 1e97f7511.

Reproduction on the original portable (51aa62cb2accfec6453c0e17e1168ee0dad4ef8f4c4cc8108d9ecb3a58fa522e): open the central viewer, expand all, then collapse surfaces, engram, design-system and cm-catalog in that order. The cm-catalog click fails with `locator.click: Timeout 1800ms exceeded`, after the button is visible, enabled, stable and scrolled into view. Evidence: kit/.cache/latency-before.log and latency-before.html.

Cause: this mixed fold misses the prepared route cache. The synchronous route search repeatedly builds visibility graphs for equivalent routed prefixes, blocking the browser event loop. Isolated FR/EN routing measured 3132/2708ms before. The fix filters obstacles per graph column/scanline and memoizes successful and failed edge attempts within one immutable scene. Search order, port allocation, labels, paths and rendering stay unchanged. Isolated routing falls to 1262/1001ms; full FR/EN resulting scenes compare byte-for-byte with the original router.

The same browser reproduction passes after (cm-catalog: 1224ms). The permanent mixed-fold regression in check-browser.mjs requires click and complete layout below the unchanged 1800ms budget in every FR/EN desktop/mobile/light/dark configuration. Console errors, title loading and visible diagram are also checked through the offline file:// URL.

Validation: source integrity; 102 geometry scenes / 732 edges with zero violations; 16 browser captures / 360 interactions; 32 slides / 52 needs / denied-storage behavior. Visual audit checks all 720 fields, 460 × 200 square cards, unchanged +4 insets, 70px zone icons, identical geometry and zero ellipses. Evidence: kit/.cache/latency-shots/measurements.json and browser-review.json.

Portable SHA-256: 45fcb489c141e4c3fd72cc9a018216d57fb6b8c604e5e0a8b2fb06ad5800b29a.

## Remaining stress-fold stall

On b92a294a9, the deterministic 120-change sequence fails at the security fold after change 81 with the unchanged 1800ms click timeout; the new permanent stressFolds regression also fails on that portable. Evidence: kit/.cache/regression-before.log. Profiling identifies coordinate-string graph/search keys, connection objects and frontier bookkeeping in uncached synchronous routing. Compact numeric adjacency/search arrays remove those allocations; sorted grid insertion replaces redundant scanline sorting while preserving neighbor order, path costs and heap ties.

Isolated original/final FR/EN routing: initial stress state 2189/2309ms → 737/673ms; later change-104 state 3922/4813ms → 1223/1848ms. All four complete resulting scenes compare byte-for-byte against the b92a294a9 router. Chromium stress now measures 693/710ms for the initial security fold, with 1224/1735ms maxima over 120 changes per language. Both click and complete layout retain the existing 1800ms gate. The 240 changes add 30.7s, so they run in the existing browser checks rather than a separate local-only check. Evidence: kit/.cache/browser-review.json and b92-{stress,late}-route-{fr,en}.json.

Validation: 102 geometry scenes / 732 edges, 16 browser captures / 600 interactions, zero console errors, 32 slides / 52 needs and denied-storage behavior. The rebuilt offline file:// portable loads its title and visible diagram. No wording, style, route geometry or timeout changes. Portable SHA-256: 2b25eb7d7c2f6fbd71b5093e86a3f19fab37c624d498ab5754d2dd811676c62e.

## Footer bottom inset restoration (2026-10-21)

Removed only footer relative positioning from `hrpolnav-card.js`, restoring the pre-padding styling at `9cb696fce`. Chromium measured the inner bottom offset at 13.25px before and 9.25px after (excluding the 2px card border). Body inset remains 4px; zone icons remain 70px; cards remain square 460 × 200. Wording and routing performance code are unchanged.

The delivered portable loads offline through its file URL with a title, visible diagram and zero console errors. The expanded English diagram retains all 28 card texts and zero literal ellipses. Evidence and 1380 × 600 Server API crops (300%) are under `.tmp/governance-unification/revert18-shots/`. The browser regression now checks the restored 4px separator-to-footer gap and 9.25px footer bottom offset.

Validation passed: 102 geometry scenes, 16 browser configurations, 600 interactions, 32 content slides and 52 need views. Card text comparisons are identical before/after.

## Product zone headers (2026-10-21)

The four product zones now use the atomic-card header hierarchy in both languages and every fold state. Grey uppercase kickers are H2A, SENTROPIC, ENGRAM and DESIGN SYSTEM. Their titles omit the former package prefix: Organisation IA responsable / Responsible AI Organization; Plateforme agentique / Agentic Platform; Connaissances qualifiées / Curated Knowledge; Vues collaboratives / Collaborative Views. Subtitle wording is unchanged and wraps below the icon at the 16px left inset. Typography uses the cards' 22:32:24 ratio at zone scale (24.75:36:27), with normal-weight kickers and bold titles. Icons remain 70px.

Expanded product headers use the atomic-card footer rule: #bdcad0, 1px, non-scaling SVG stroke, 16px left and 10px right margins. Chips and tabs retain their labels to identify the product when selecting a zone. Unchanged zones: Access surfaces; 3. Catalogs; MCP · Connectors; 4. Storage; 5. Security and observability; 6. Integration (and their French labels).

Prepared route geometry and summary frame positions/dimensions compare identically against ef884f858; only product header metrics in fold-cache signatures change. Chromium checks cover offline file URLs, loaded title, visible diagram, zero console errors, zero ellipses, text containment, header separation, children below separators and aligned rows. Four 1920px screenshots and the detailed measurements are in `.tmp/governance-unification/zonehdr20-shots/`. The existing browser contrast regression also verifies the kickers in dark mode; they use the theme's secondary-text token.

## One component for every zone header (onecomp23)

The clean starting head was `c6b22bbab` (main-merge-22). Every zone now uses
one renderer and one measured header layout, in FR/EN and every fold state.
The old right-indented subtitle renderer, its measurement path and its separator
style are removed. Kickers use regular-weight grey uppercase text; subtitles
wrap from the 16-unit left inset. Expanded zones use the cards' non-scaling 1px
separator with 16-unit left and 10-unit right margins. Long kickers wrap too.

The five Sentropic sub-zones deliberately use the owning package `SENTROPIC`
as their kicker and retain their current titles. This is an author choice for
the owner to revise, without an owner-approval claim.

| Zone | FR kicker | FR title | EN kicker | EN title |
| --- | --- | --- | --- | --- |
| h2a | H2A | Organisation IA responsable | H2A | Responsible AI Organization |
| Access | SENTROPIC & TIERS | Surfaces d’accès | SENTROPIC & 3RD PARTIES | Access surfaces |
| Sentropic | SENTROPIC | Plateforme agentique | SENTROPIC | Agentic Platform |
| Catalogs | SENTROPIC | 3. Catalogues | SENTROPIC | 3. Catalogs |
| MCP | SENTROPIC | MCP · Connecteurs | SENTROPIC | MCP · Connectors |
| Storage | SENTROPIC | 4. Stockage | SENTROPIC | 4. Storage |
| Security | SENTROPIC | 5. Sécurité et observabilité | SENTROPIC | 5. Security and observability |
| Integration | SENTROPIC | 6. Intégration | SENTROPIC | 6. Integration |
| Engram | ENGRAM | Connaissances qualifiées | ENGRAM | Curated Knowledge |
| Design System | DESIGN SYSTEM | Vues collaboratives | DESIGN SYSTEM | Collaborative Views |

The same renderer/layout also serves the study diagrams. Chromium measures
60 expanded zone-header occurrences across all FR/EN scenes and all 720 leaf
fields: zero clipping and zero ellipses. Subtitles start at x + 16, end inside
the 460-unit header width and remain above their separator. The central
collapsed and Sentropic-expanded views retain aligned responsibility rows.
Source comparison confirms unchanged zone titles/subtitles, leaf wording,
460 × 200 leaf footprints, edge identities, endpoints and labels.

Offline Chromium loads the delivered portable through its `file://` URL:
the document title is loaded, the diagram is visible and no console or page
error is reported. Source, 102-scene/732-edge geometry and 32-slide/52-need
content checks pass. Evidence and four 1920 × 1080 screenshots (FR/EN,
collapsed overview and Sentropic expanded) are under
`.tmp/governance-unification/onecomp23-shots/` in the root checkout;
`browser.json`, `measurements.json` and `all-scenes.json` contain the measured
bounds, kickers, titles and all leaf fields.

The complete browser gate passes: 16 captures and 600 interactions, including
120 stress folds per language under the unchanged 1800ms budget. Three earlier
full runs expired during stress after the shared browser matrix (EN change 61;
FR change 95 twice), while the separate 240-change traversal passed. The gate
now launches a fresh Chromium process for each latency traversal, isolating it
from the preceding matrix. The final full gate passes with this isolation;
production rendering, routing code and interaction thresholds are unchanged.

## Exact atomic typography for zone headers (titlesize24)

Starting head: `90e105b4e`. Chromium reproduced the leftover 1.125 scale:
zone kicker/title/subtitle sizes were 24.75/36/27px, versus 22/32/24px
on atomic cards. The renderer and wrapping measurements now use card sizes
directly, in every language, scene and fold state.

| Role | Zone / card size | Weight | Line-height | Colour | Letter-spacing |
| --- | --- | --- | --- | --- | --- |
| Kicker | 22 / 22px | 400 / 400 | 28.6 / 28.6px | #52656b | 0.88 / 0.88px |
| Title | 32 / 32px | 700 / 700 | 41.6 / 41.6px | #172033 | normal |
| Subtitle / card body | 24 / 24px | 400 / 400 | 31.2 / 31.2px | #172033 | normal |

Computed font families also match: embedded Dossier Inter for titles and the
same sans-serif stack for kickers and body text. The browser regression now
compares computed size, line-height, weight, family, case, spacing and colour
for every expanded zone against the corresponding atomic role. The evidence
probe compares collapsed headers against those same measured card styles.

Contracting the header slots initially blocked routing for `e-api-ai`;
adding clearance still produced a stress-fold timeout. Header slots now
retain their validated dimensions independently of the rendered typography,
preserving icon positions, routing geometry and aligned rows. Cards, insets,
icons and wording are unchanged. Dark-mode zones use the cards' white surface and a #718c93
border, retaining contrast against both the white fill and dark canvas.
The identical fixed text colours remain readable;
light-mode zone surfaces retain their existing colours.

The delivered portable was opened offline in Chromium through its `file://`
URL: title loaded, diagram visible, zero console/page errors. All 60 expanded
FR/EN header occurrences and 720 card fields fit, with zero clipping or
ellipses. Central collapsed, Sentropic-expanded and fully expanded headers
were measured separately. Card footprints remain 460 × 200 and collapsed
frames remain 460 × 272; source comparisons confirm unchanged wording and
icons. Every prepared zone/card position, dimension and reserved header height
also compares equal to the initial head; prepared routes are byte-identical.
Source, 102-scene/732-edge geometry and 32-slide/52-need content checks
pass with zero geometry defects.

Evidence is under `.tmp/governance-unification/titlesize24-shots/` in the root
checkout: four 1920px FR/EN overview/Sentropic captures, the 300% side-by-side
`en-access-ai-providers-300pct.png`, computed roles in `browser.json`, and
all-scene text measurements in `all-scenes.json`. The comparison crop clones
the rendered zone/card into one SVG at exactly three pixels per diagram unit.

The complete local browser gate is not green: repeated runs produced all
16 matrix captures and passed their typography, containment and contrast
assertions, but expired at the unchanged 1800ms interaction budget (a mobile
tap, FR stress folds 57 and 96; a dedicated traversal also expired at fold
15). Reports are retained in `browser-*-timeout.json` and `stress.json`.
Isolated routing at fold 96 took 553ms FR / 372ms EN. The host reported load
averages above 30 on 32 CPUs; this observation does not waive the failed gate.
No timeout, router or production interaction code was changed to bypass it.

## Expanded zone gaps — PR #711, 2026-10-21

Every expanded frame now uses **72 px in diagram coordinates**, the existing
vertical gap between stacked cards. The separator and first child row share
this spacing at every depth, in French and English.

| Zones | Before FR | Before EN | After FR/EN |
| --- | ---: | ---: | ---: |
| h2a, Access surfaces, Design System, MCP, Security and study frames | 136 | 136 | 72 |
| Sentropic | 200 | 200 | 72 |
| Catalogues, Storage and Integration | 182 | 182 | 72 |
| Engram | 171 | 136 | 72 |

Frames shrink with their content: h2a/Access are 532 → 468 px; Sentropic is
1701 → 1445 px, including its nested reductions; the four aligned Sentropic
sub-zones are 1270 → 1142 px. All card content and footprints, header wording,
icons and 24 fully collapsed geometry/route snapshots match the starting head.

No label occupies the header-to-child gap. The three h2a links to AI, Cowork
and CLI carry “Harnais et collaboration” / “Harness and collaboration” in
card gutters or exterior lanes. Across expanded projections, 154 FR/EN edge
instances (46 distinct relations) change their route or label placement;
another 24 only translate with the layout. The complete IDs, points and label
boxes are recorded in root `.tmp/governance-unification/gap30-shots/report.json`.
Open frames permit gutter transit; headers, cards, other edges and labels remain
obstacles. Labels retain the validated incremental routing order: the isolated
FR stress state 114 drops from 2616 ms to 92 ms without changing the UI budget.

The final portable passes source, 102-scene/732-edge geometry, 16 browser
captures, 600 interactions and 32-slide/52-need content checks. Rows deviate
by 0 px; all collision counters, clipped fields, ellipses and console errors
are zero. Worst browser interaction: 784 ms against the unchanged 1800 ms
budget. Worst load: 218 ms; expand-all: 98 ms; ten-second idle task work:
1.33 ms, with no idle script/animation/resize work. Maximum heap: 10,021,896
bytes against the existing 32 MiB limit.

Chromium opens the delivered `file://` portable offline with its title loaded
and diagram visible in all six requested 1920px FR/EN captures. Screenshots,
SVG gap measurements, unchanged-collapse comparisons and the regression that
rejects the starting head are under root `.tmp/governance-unification/gap30-shots/`.
Portable SHA-256: `de07c0cefe32624afafa1c08f0a57203a71b6726a52e46d7be2cf36deb379966`.
