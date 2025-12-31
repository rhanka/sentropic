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
- [ ] **UI step 4 (UAT)**: Add a responsive Header burger menu (includes nav + language + user) starting at tablet width; also force burger when ChatWidget is docked to preserve header readability.
- [ ] **Local gates (before UAT)**: `make typecheck-ui` and `make lint-ui`, sanity via `make logs-ui`.
- [ ] **UAT 4 (you, in `make dev`)**: Validate header burger behavior (tablet + when docked) and that it never shows the old full nav when space is constrained.
- [ ] **After UAT approval**: Add/adjust UI tests (targeted) if applicable.
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
- [ ] **Commit 1**: Responsive layout (mobile bottom-sheet + desktop max sizing)
- [ ] **Commit 2**: Accessibility (ESC + focus trap + aria)
- [ ] **Commit 3**: Desktop docked panel mode + local persistence
- [ ] **Commit 4**: Tests (UI/E2E adjustments if needed)

## Status
- **Progress**: Waiting for UAT 2 + UAT 3 feedback
- **Current**: Ready for UAT (no further UI changes planned until feedback)
- **Notes**:
  - Mobile: bottom-sheet + dimmed backdrop implemented
  - Desktop: viewport-safe sizing implemented (max width/height to avoid overflow)
  - Mobile: scroll-lock added to prevent background scrolling when sheet is open
- **UAT 1**: ✅ Mobile view validated (backdrop OK, mobile behavior OK)
- **A11y**: ESC closes, focus moves into the widget on open, focus returns to the bubble on close, focus trap enabled in floating mode
- **Docked mode**: toggle button added in the header, preference persisted in `localStorage`
- **Next (you)**: Run UAT 2 + UAT 3 in `make dev`

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

## Decisions for UI step 3 (confirmed)
- Docked mode **pushes** main content (no overlay).
- Docked panel is shown when opened and can be **closed with the X button** (like current).
- Docked width is responsive:
  - Desktop: **~33%**
  - Tablet / intermediate: **~50%**
  - Mobile: **100%** (full screen)


