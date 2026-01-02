# Feature: Responsive floating Chat/Queue widget + accessibility

## Objective
Improve the floating Chat/Queue widget so it works reliably on mobile and desktop:
- Mobile: full-screen / bottom-sheet behavior (no overflow, stable scrolling)
- Desktop: max sizes + stable internal scroll (no viewport overflow)
- Accessibility: ESC close, focus trap, proper aria, keyboard navigation

This branch is explicitly organized to enable early UAT in `make dev` before deeper refactors/tests.

## Plan / Todo (UAT-first)
- [x] **UI step 1 (UAT early)**: Make the floating panel responsive (mobile bottom-sheet + desktop max sizing) without changing business logic.
- [x] **Local gates (before UAT)**: `make typecheck-ui` and `make lint-ui`, then quick sanity via `make logs-ui` (no runtime errors).
- [x] **UAT 1 (you, in `make dev`)**: Validate mobile/desktop layout + scrolling + “Chat/Queue” flows are usable.
- [x] **UI step 2 (UAT)**: Add accessibility behavior (role=dialog, aria, ESC, focus trap, return focus, keyboard loops).
- [x] **Local gates (before UAT)**: `make typecheck-ui` and `make lint-ui`, sanity via `make logs-ui`.
- [x] **UAT 2 (you, in `make dev`)**: Validate keyboard-only usage + screen reader basics (labels/roles) + ESC works.
- [x] **UI step 3 (UAT)**: Desktop “docked panel” mode (~1/3 right side) toggleable with the current floating widget; persist the chosen mode in browser storage (localStorage).
- [x] **Local gates (before UAT)**: `make typecheck-ui` and `make lint-ui`, sanity via `make logs-ui`.
- [x] **UAT 3 (you, in `make dev`)**: Validate docked mode usability + persistence across reload + no layout regressions.
- [x] **UI step 4 (UAT)**: Fix Header i18n by using `svelte-i18n` directly in `Header.svelte` (reuse `src/locales/*.json` dictionaries; avoid deeper refactor).
- [x] **Local gates (before UAT)**: `make typecheck-ui` and `make lint-ui`.
- [x] **UAT 4 (you, in `make dev`)**: Validate language switcher affects Header labels reliably (FR default; EN switching works; persists after reload).
- [x] **UI step 5 (UAT)**: Header responsive burger menu (tablet breakpoint + forced when chat is docked) including language + identity inside the burger drawer.
- [x] **Local gates (before UAT)**: `make typecheck-ui` and `make lint-ui`.
- [x] **UAT 5 (you, in `make dev`)**: Validate burger behavior on tablet + when chat is docked (menu not cramped; drawer contains lang + identity accordion + actions).
- [x] **After UAT approval**: Add/adjust UI tests (targeted) if applicable.
- [ ] **Production gates**: `make build-ui-image build-api` then `make test-e2e`.

## UAT Checklists (high-signal)
### UAT 1 — Responsive layout
- Bubble opens the panel reliably (mouse + keyboard)
- Mobile (<= sm): panel behaves like a bottom-sheet (no horizontal overflow), content scrolls inside panel, background is dimmed, close is obvious
- Desktop (>= sm): panel stays inside viewport (no overflow), internal scroll is stable for Chat and Queue
- Switching tabs (select: sessions / jobs) still works

### UAT 2 — Accessibility
- ESC closes the panel
- Focus moves into the panel when opened and is trapped inside while open
- Focus returns to the bubble button when closed
- ARIA: bubble exposes expanded state; panel exposes dialog semantics

## Commits & Progress
- [x] **Commit 1**: Responsive layout (mobile bottom-sheet + desktop max sizing)
- [x] **Commit 2**: Accessibility (ESC + focus trap + aria)
- [x] **Commit 3**: Desktop docked panel mode + local persistence
- [x] **Commit 4**: Header i18n via svelte-i18n (UAT 4)
- [x] **Commit 5**: Header responsive burger menu (UAT 5)
- [x] **Commit 6**: Tests + regressions (E2E updates + UI fix P2)

### Latest commits (high-signal)
- `fa821a5` — feat(ui): always render dashboard scatter plot independent of executive summary
- `6d07f5e` — fix(ui): header nav disabled reactive + aria-disabled (no href #)
- `5ea209b` — test(e2e): adapt header nav + stabilize workflow assertions
- `8930d4c` — docs: refine P2 analysis + e2e stabilization notes

## Status
- **Progress**: UAT 1–5 ✅, commits ✅, local E2E stabilization ✅
- **Current**: Waiting for CI run on branch after push
- **Next**: Run full production gates when needed: `make build-ui-image build-api build-e2e` then `make test-e2e`
- **Notes**:
  - Mobile: bottom-sheet + dimmed backdrop implemented
  - Desktop: viewport-safe sizing implemented (max width/height to avoid overflow)
  - Mobile: scroll-lock added to prevent background scrolling when sheet is open
- **UAT 1**: ✅ Mobile view validated (backdrop OK, mobile behavior OK)
- **A11y**: ESC closes, focus moves into the widget on open, focus returns to the bubble on close, focus trap enabled in floating mode
- **Docked mode**: toggle button added in the header, preference persisted in `localStorage`
- **E2E (local)**:
  - `E2E_SPEC=tests/app.spec.ts make test-e2e`: ✅ (5 passed)
  - `E2E_SPEC=tests/dashboard.spec.ts make test-e2e`: ✅ (scatter plot container now always present when a folder is selected)
  - `E2E_SPEC=tests/workflow.spec.ts make test-e2e`: ✅ (4 passed, 1 skipped)

## UAT feedback fixes (in progress)
## UAT feedback fixes (done)
- Focus: first focus goes to the chat composer input
- Keyboard open: bubble supports Enter/Space; global shortcut added (**Ctrl+Shift+K**) (ignored while typing)
- Dock toggle icons: switched to maximize/minimize icons
- Dock width: minimum enforced (never smaller than widget width); fallback to 50% when 33% would be too small
- Mobile: dock-only (no widget mode / no toggle)
- Dock: no shadow

## Follow-up fixes (done)
- Tab navigation: tabbing from the chat composer now goes to the header select (and focus is trapped in both floating and docked modes).
- Global shortcut: `Ctrl+Shift+K` now also closes the widget even while typing in the composer.
- Dock toggle: fixed a Svelte reactivity issue (removed function call in template; switched to reactive `isDocked/effectiveMode` vars) so the dock/widget switch updates reliably in dev Docker.
- Dock push: fixed an inversion bug by computing the effective mode inside `publishLayout()` (avoids reactive timing issues that could invert the padding-right behavior).
- Mobile: dock toggle icon is now hidden via responsive CSS (`hidden sm:inline-flex`) to avoid any mobile flash; close button remains visible.

## Latest gates (done)
- `make typecheck-ui`: ✅
- `make lint-ui`: ✅
- `TAIL=200 make logs-ui`: ✅ (no runtime errors spotted; only missing env var warnings)

## CI / Tests — E2E failures (repro + files)

### Quick links (files)
- **UI**: [`ui/src/lib/components/Header.svelte`](ui/src/lib/components/Header.svelte)
- **UI**: [`ui/src/lib/stores/session.ts`](ui/src/lib/stores/session.ts)
- **E2E**: [`e2e/tests/app.spec.ts`](e2e/tests/app.spec.ts)
- **E2E**: [`e2e/tests/workflow.spec.ts`](e2e/tests/workflow.spec.ts)
- **E2E**: [`e2e/playwright.config.ts`](e2e/playwright.config.ts)
- **Make**: [`Makefile`](Makefile) (`build-ui-image`, `build-api`, `build-e2e`, `test-e2e`)

### Constraint
- **No API changes** on this branch during E2E stabilization.

### How to reproduce locally
- **Build**: `make build-ui-image build-api build-e2e`
- **Run (scoped)**:
  - `E2E_SPEC=tests/app.spec.ts make test-e2e`
  - `E2E_SPEC=tests/workflow.spec.ts make test-e2e`

### Evidence generated by Playwright (local)
- **Artifacts folder**: `e2e/test-results/`
  - `app-Application-principale-*/*` (`error-context.md`, `test-failed-1.png`, optional `trace.zip`)
  - `workflow-Workflow-métier-*/*` (`error-context.md`, `test-failed-1.png`, optional `trace.zip`)

### Issues table (what / why / where)
| ID | Type | Test | Symptom | Evidence | Suspected area |
|---|---|---|---|---|---|
| P1 | Evolution (expected UI change) | `e2e/tests/app.spec.ts` | `"Paramètres"` moved from main nav into Identity menu | ✅ Fixed: test asserts it under Identity menu | E2E only |
| P2 | UI regression (links disabled on `/`) | `e2e/tests/app.spec.ts` | Header links rendered as disabled (`href="#"`) while user visible | ✅ Fixed (UI): keep real `href`, add `aria-disabled`, reactive disabled map | `Header.svelte` |
| P3 | UI regression / mismatch | `e2e/tests/workflow.spec.ts` | Scatter plot container not always rendered (was conditional to executive summary) | ✅ Fixed (UI): scatter plot container rendered independent of executive summary | `ui/src/routes/dashboard/+page.svelte` |

### Current state
- **P1/P2/P3**: ✅ stabilized locally (see Status / E2E local section above)

### P2 — Context + hypotheses + proposed fixes (no changes yet)
- **Observed (local repro)**:
  - E2E run: `E2E_SPEC=tests/app.spec.ts make test-e2e`
  - failing step: click `"Dossiers"` then `expect(page).toHaveURL('/dossiers')` (URL stays `/`)
  - evidence file: `e2e/test-results/app-Application-principale-e762e--vers-les-différentes-pages-chromium/error-context.md`
  - snapshot shows:
    - header user button visible: `"E2E Admin"`
    - but nav links are rendered with `/url: "#"` (disabled) for `"Dossiers"`, `"Organisations"`, `"Cas d'usage"`, `"Évaluation"`, `"Dashboard"`
- **Why this points to UI (not data)**:
  - DB is seeded (folders exist); the failure is before `/dossiers` loads.
  - The link is literally `href="#"` in the DOM snapshot.
- **Diff-based analysis (what changed vs `origin/main`)**
  - **Important**: the *exact* “disable links” mechanism already exists on `origin/main`:
    - `{@const isDisabled = isMenuDisabled(item.href)}`
    - `href={isDisabled ? '#' : item.href}`
    - and `isMenuDisabled()` reads `$isAuthenticated` / `$currentFolderId`
  - Therefore, we **cannot** claim “we introduced that logic” in this branch.
  - What we **did** change in this branch is the **Header structure + lifecycle around it**:
    - added responsive/burger state (`showBurgerMenu`, `showCompactHeader`, `forceBurger`)
    - added `onMount` / `onDestroy` with `matchMedia` listeners + global keydown + custom event listener
    - changed i18n wiring in-header (direct `$_(...)` usage + `currentLocale` binding)
    - moved `"Paramètres"` out of `navItems` (main nav) into the Identity menu
  - `ui/src/lib/stores/session.ts` is **unchanged** in this branch vs `origin/main` (so not an auth logic regression).
- **Root cause hypothesis (must be confirmed; analysis-only)**
  - The Playwright snapshot proves a contradictory UI state:
    - user button is visible (so `$isAuthenticated` is effectively true in at least one place),
    - but nav links are still rendered as disabled (`href="#"`) as if `$isAuthenticated` was false at the time `isDisabled` was computed.
  - That strongly suggests a **stale computation** of `isDisabled` (computed earlier, not recomputed later).
  - The most suspicious pattern (present in main but potentially “exposed” by our Header refactor) is:
    - computing `isDisabled` once via `{@const ... = isMenuDisabled(...)}` where the function reads `$store` values.
    - If the nav block isn’t recreated after session becomes ready, `isDisabled` can remain stuck on the initial non-auth value.
  - To be totally rigorous about “what changed”, the actionable statement is:
    - **the branch refactor changed update/mount timing** of Header (extra state + listeners), and this now **exposes** a stale-disabled-nav behavior reproducible in E2E.
    - We need to confirm by instrumenting or inspecting compiled output (not done yet, since we are not changing code in this phase).
- **Fix proposals (UI)**:
  - **Option 1 (preferred)**: inline the disabled expression so it depends directly on `$isAuthenticated` / `$currentFolderId` in the template (no helper function call).
  - **Option 2**: compute a reactive boolean map in script with `$:` that explicitly references `$isAuthenticated` / `$currentFolderId`, then use that value in the template.
  - **Option 3**: make `isMenuDisabled` accept plain booleans (e.g. `isMenuDisabled(href, $isAuthenticated, $currentFolderId)`) so the template references the stores directly.
- **Validation plan**:
  - rerun `E2E_SPEC=tests/app.spec.ts make test-e2e` and confirm `error-context.md` shows `/url: /dossiers` (not `#`) and navigation passes.

### P2 — Implemented fix (A + D)
- **A (reactivity)**: compute disabled map in `<script>` using `$isAuthenticated` + `$currentFolderId` so it updates after session hydration on `/`.
- **D (no `href="#"`)**: keep real `href` for links, use `aria-disabled` + `tabindex=-1`, and preventDefault on click when disabled.

### P3 — Context + proposed fixes (tests vs UI)
- **Observed (local repro)**:
  - E2E run: `E2E_SPEC=tests/workflow.spec.ts make test-e2e`
  - evidence: Playwright call log shows `locator('.report-scatter-plot-container, canvas, svg').first()` resolves to the header SVG icon `lucide-menu` and it is `hidden`.
- **Fix proposals**:
  - **Option 1 (test-only)**: change selector to `.report-scatter-plot-container` (no `svg`, no `.first()`).
  - **Option 2 (UI + test)**: add `data-testid="dashboard-scatter-plot"` on the container and assert via `getByTestId`.
  - **Option 3 (test-only)**: scope selector under the dashboard main content (e.g. `main .report-scatter-plot-container`).

### P3 — Implemented fix (UI)
- Change dashboard rendering so the scatter plot container (`.report-scatter-plot-container`) is **not** conditional on executive summary presence.
- This aligns with product expectation: the chart should be available even before / without executive summary.

### Additional tests (proposal)
- **E2E**: burger menu appears on tablet + when chat is docked; opens above chat (z-index).
- **E2E**: Identity menu highlights on `/parametres` and `/auth/devices` (desktop + burger).
- **E2E**: i18n persists across reload (FR → EN → reload → EN).

## Decisions for UI step 3 (confirmed)
- Docked mode **pushes** main content (no overlay).
- Docked panel is shown when opened and can be **closed with the X button** (like current).
- Docked width is responsive:
  - Desktop: **~33%**
  - Tablet / intermediate: **~50%**
  - Mobile: **100%** (full screen)


