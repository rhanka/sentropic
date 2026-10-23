# Governance convergence on the hrpolnav base

## Sources and precedence

Owner order: `.tmp/governance-unification/OWNER-ORDER-711-hrpolnav-base.md`, 2026-10-22.
Reference: owner-validated `6bb351559fa707a8cd304c4c3498a29f775e0abe`, merged by #711 as `4138a0ecba9c5b37409abb5ac00f732d02b7dc8d`.
Read-only hrpolnav source: `docs/ard/decision/focus/governance-kit/PROVENANCE.md`, `hrpn/FOLDED-CARD-HACKS.md`, `hrpn/{fold,pack,render,scene-adapter}.js`, `hrpn/tints.css`.
Read-only DS source: `spec/diagram-cards` at `97ecf69b21b6af12583ca085b78278426fb32491`, `spec/SPEC_EVOL_DS_DIAGRAM_CARDS.md`, revision r2.
Neither source repository was modified. The first read saw r1; r2 appeared during implementation and was re-read before qualification.

## Replaced hacks

HRPN locators below are relative to `docs/ard/decision/focus/governance-kit/`; implementation locators are relative to `docs/governance/kit/`.

| Hack | HRPN file:line | Structural replacement |
| --- | --- | --- |
| H1: scene-specific folded height | `hrpn/pack.js:17,21,51,85`; `hrpn/scene-adapter.js:175` | `src/governance-layout.js:6`: collapsed height aliases `CARD_HEIGHT`; both packers always use 460 × 200, with no scene override. |
| H2: separate folded card painter | `hrpn/render.js:31–56` | `src/architecture-svg.js:34`: collapsed zones directly call `renderStructuredCard` (`src/hrpolnav-card.js:4`), the same renderer used by leaves. The centred summary is the card's own body mode. |
| H3: cut/reinsert SVG strings | `hrpn/render.js:59,77–86` | The normal group render branch composes card and toggle directly; no SVG searches, slices or replacement. |
| H4: delete SVG rule after rendering | `hrpn/render.js:53` | `src/hrpolnav-card.js:6,18`: optional footer/rule slots are selected at construction. The SVG paints the only separator; the HTML spacer allocates its layout space without paint. No rendered element is deleted. |
| H5: invented folded-only footer/tint fields | `hrpn/scene-adapter.js:127–128` | Existing scene subtitle and header fields feed the shared card; no HRPN footer is fabricated. Existing leaf attributions stay unchanged. |
| H6: tint injection and duplicated CSS | `hrpn/render.js:74–76`; `hrpn/tints.css:11–14,20–23` | The card retains the validated atomic palette in both uses; ordinary zone/legend tones use the existing semantic palette. No HRPN tint vocabulary or `data-tint` is imported. |
| H7: fixed 290 px title, 66 px padding, parentheses relocation, summary deletion | `hrpn/render.js:36–43,50–55`; `hrpn/tints.css:24–27` | Shared card header grid contains icon, flexible text and actual DS IconButton slot. No title edit, clamp or summary deletion. Complete strings that exceed 200 px surface as diagnostics. |
| H8: split subtitle into function/detail | `hrpn/render.js:44–48`; `hrpn/scene-adapter.js:zoneText` | One subtitle string wraps in the atomic card body, centred at a 396 px measure. No secondary-colour reassignment. |
| H9: compactLegend filter/append | `hrpn/scene-adapter.js:152–153,166–168`; `hrpn/pack.js:14,34`; `hrpn/render.js:15–29,59–61` | `src/governance-legend.js` supplies an ordinary zone with typed swatch/link entries; both packers allocate its content; the normal group renderer paints entries inside the zone. Solid and dashed relations remain documented. |

Related r2 replacements: arbitrary scene folding replaces the central-only gate (`hrpn/fold.js:1–14`); the existing prepared-route and bounded runtime-cache mechanisms remain. The button `foreignObject` sizing pass is removed; a card's own grid contains its toggle, and expanded-zone controls use the same 32 px DS control with 10 px outer inset. No icon registry mutation or kicker string replacement is imported.

## Divergences and content conflict

- **Intentional 272 → 200 change:** owner order and r2 supersede #711's collapsed height (DIF-01). Rebuilt routing uses actual card boxes; ELK's prior manually adjusted polylines no longer fit the shorter boxes. The normal collision-free router now permits alternative side plans for summary edges. No crossing relaxation is imported.
- **Preserved leaf values versus DS DIF-05/06/08/09:** retain the validated 20 px body glyph inset, fixed reference palette, embedded bold Inter and white expanded-zone surfaces in dark mode. r2 asks for 14 px, semantic-only palettes and no embedded font. Changing them here would contradict the owner's preservation instruction. These remain explicit DS migration differences.
- **DS DIF-03/04/07 aligned:** square zones now own `rx=0` without a style-mode override. The shared card pins its footer at 9.25 px through its own layout; an unpainted spacer allocates the separator and the SVG paints one non-scaling rule. All 144 actual cards retain their measured slot positions, and 0/1/2 body-line fixtures retain the 9.25 px footer inset. Folded zones have no supplied footer and therefore no footer rule; no HRPN attribution is invented.
- **DS DIF-10/11:** existing scene header kicker derivation and title-prefix removal remain for compatibility with #711 data; the legend supplies its kicker explicitly. The DS profile migration remains outside this documentation-kit change. No new title pre-fitting table or text relocation is introduced.
- **DS DIF-14/15:** unspecified zone pictograms retain the reference server fallback; DS components instead require an omitted icon slot or an unknown-icon diagnostic. Actual kit card/zone calls remain 70 px, while the generic glyph helper's unused 42 px default is unchanged.
- **Expanded header preservation:** keep the validated shared SVG zone header and its exact 4/16/16 rhythm. Collapsed headers are the atomic card's HTML header. r2 eventually composes both through `DiagramCardHeader`; this kit preserves the validated SVG header rather than replacing its rendering device.
- **Content conflict, pending owner answer:** several complete validated zone headings/subtitles cannot fit at 460 × 200 with unchanged font sizes. FR central `cluster-mesh` needs a two-line title plus three summary lines; secondary scenes contain much longer headings (for example `ann-comments`). No text is shortened, clipped or hidden. `ArchitectureFigure.svelte` surfaces measured `data-card-overflow` entries in a diagnostics list. The strict browser fit gate remains blocking on these occurrences. An owner question requests permission for canonical FR/EN wording changes; no unanswered question is treated as permission.
- **Diagnostics contract:** the kit surfaces entity/slot names. r2's typed `onDiagnostic({entityId,slot,neededPx,allocatedPx})` belongs to the future DS component API and is not claimed by this standalone kit.
- **HRPN consumer features:** HRPN-specific tints, default fold sets, column stretch, 96 px zone gap and relaxed edge crossings are not copied. This kit retains its own scene data/default all-collapsed state and strict route gates. Legend entries reflect Sentropic's existing amber/blue and solid/dashed meanings.
- **Budget witness count:** the inherited browser script counted its 240 stress toggles inside its reported 600 interactions. To satisfy r2's explicit 600 plus 240 witness, the shared-frame traversal now runs twice: 656 normal interactions plus 240 stress toggles, with the same 1800 ms limit.

The pending fit conflict covers 35 collapsed zone occurrences across nine scene/locale pairs, including 13 long title occurrences. Canonical strings remain intact in both folded and expanded views; no parentheses relocation, summary deletion, size increase or font reduction is applied.

| Scene | FR overflowing zones | EN overflowing zones |
| --- | --- | --- |
| central | `cluster-mesh` | None |
| annotate | `ann-ui`, `ann-comments`, `ann-h2a` | Same three |
| ontologies | `onto-graph`, `onto-skills`, `onto-layout`, `onto-bpmn` | Same four |
| memory | `mem-core`, `mem-time`, `mem-pipeline`, `mem-live`, `mem-h2a` | Same five |
| traceability | `trace-1-2`, `trace-3-4`, `trace-5-6`, `trace-7`, `trace-loop` | Same five |

## Qualification and delivery

- Geometry: **1,758 FR/EN states, 16,740 edges**, zero crossings, header/card intrusions, overlaps, detached endpoints or pill collisions. This includes every additional overview fold plan; slowest plan replay was 121 ms, below the unchanged 1800 ms limit.
- Runtime planning: 1,356 port/order plans occupy **76,433 bytes**, covering the overview states without a full prepared geometry. Plans are validated by the ordinary router; an obsolete hint returns to the same search. Build workers reuse validated hints across identical relation topologies and locales. No continuous browser work or additional routing mode is introduced.
- Reference cards: **144 occurrences / ten scene-locale pairs**, identical text, palette, font properties and slot geometry within 0.02 px (maximum observed rounding delta 0.01 px); footer pin checked with 0/1/2 body lines.
- Chromium matrix: **16 captures, 896 interactions (656 normal + 240 stress)**; maximum **1019 ms**, zero console errors. Four FR collapsed text-fit failures remain, all naming `cluster-mesh`; they keep the strict command failing. The all-scene convergence command likewise remains `fit-blocked` on the nine cases above. No failure is waived. A concurrent browser campaign exceeded 1800 ms; the final isolated run on the same portable completed all 896 interactions without changing that limit.
- Content: all **32 slides and 52 need routes** retain their content checks; storage-denied language switching passes, zero console errors. The command ends `fit-blocked` with 44 repeated text-fit findings across its views, rather than skipping those assertions.
- Idle/load witness: four scenarios (one/three tabs, collapsed/expanded), title loaded, visible SVG, no console errors; maximum idle task 2.11 ms / script 0 ms, zero RAF / ResizeObserver callbacks over 10 s; maximum load 724 ms and heap 21.6 MB (< 32 MiB). No threshold or timeout was raised. The 11 inherited README SVG illustrations also pass light/dark and 1200/390 px embedding checks; this delivery rebuilds the interactive kit and portable.
- Browser environment: the configured MCR image could not be pulled because the registry resolved to unreachable IPv6. Qualification uses a temporary Node 24 Debian image with native libraries and Chromium 153 (Playwright revision 1243); the reference fallback face is **WenQuanYi Zen Hei**, with the original embedded Dossier Inter for bold slots. The original portable is rendered in the same environment for the independent parity witness. Temporary image/output is removed after qualification.
- Final delivered portable: `governance-r11-portable.html`, sha256 **`ad674c3563cc71814c89aa9f03eda1d6f937ae9c7b8dd9fad62f14e9ca651db8`**. Screenshots: root `.tmp/governance-unification/converge32-shots/{fr,en}-{overview-collapsed,sentropic-expanded}-1920.png` (1920 × 1080). The file URL is used offline; title, diagram and console are checked for both locales.
- Delivery: draft [PR #726](https://github.com/rhanka/sentropic/pull/726), no merge. Final pushed head and its GitHub CI result are recorded in the PR delivery comment. Strict local text-fit qualification remains pending the owner wording decision, independently of GitHub CI.
