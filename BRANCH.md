# Feature: chat-ui preprocessed dist for external consumers (svelte-package)

## Objective
Make `@sentropic/chat-ui` consumable by EXTERNAL npm apps (mermaid/radar) zero-config: ship a PREPROCESSED `dist/` (TS stripped from `.svelte`, styles processed, `.d.ts` emitted) via `@sveltejs/package`, repoint `exports` → `dist/`, bump 0.10.0 -> 0.11.0. Keep the sentropic app UNCHANGED by aliasing it to `src` (so app behaviour/HMR/e2e still validate the real source). Fixes the "`<script lang=ts>` raw .svelte 500s consumers (postcss Unknown word)" reported by claude:mermaid-editor.

## Scope / Guardrails
- Make-only; ENV last; worktree `tmp/chatui-package-dist`; never `ENV=dev`; never `make clean-all`.
- App must keep building + e2e green (the regression net). The app stays on `src` via a vite alias → app behaviour unchanged.
- All text English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/chat-ui/package.json` (exports→dist, version 0.11.0, devDeps, files)
  - `packages/chat-ui/svelte.config.js` (NEW — vitePreprocess for DOM tests; build step uses temp svelte-preprocess config)
  - `packages/chat-ui/tsconfig.json` (only if needed for svelte-package)
  - `packages/chat-ui/export-manifest.json` (dist paths + version 0.11.0)
  - `packages/chat-ui/.npmignore` or `files` (ensure dist published, src excluded if desired)
  - `packages/chat-ui/tests/export-surface.spec.ts` (updated for dist-based exports)
  - `packages/chat-ui/tests/chat-conversation.spec.ts` (version bump from 0.10.0 to 0.11.0)
  - `ui/vite.config.ts` (add alias `@sentropic/chat-ui` → `../packages/chat-ui/src`)
  - `BRANCH.md`
- **Conditional Paths (declare BR-PKG-EXn before touching)**:
  - `Makefile` — `BR-PKG-EX1`: change `build-chat-ui` to run `svelte-package` (preprocessed dist) instead of bare `tsc`; also add `svelte-preprocess@6.0.3` to `test-chat-ui-dom` install so svelte.config.js can load. Rationale: produce a consumable published artifact; impact: build target only; rollback: revert the target.
- **Forbidden Paths**:
  - `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - `packages/chat-ui/src/**` (NO component/source change — packaging only)
  - other `ui/**` (besides vite.config.ts), `api/**`

## Feedback Loop
- BR-PKG-EX1: Makefile `build-chat-ui` and `test-chat-ui-dom` targets modified. build-chat-ui: runs `svelte-package -i src -o dist` with a temporary svelte.config.js that uses svelte-preprocess (TS stripping), then restores the original vitePreprocess-based config; post-processes with `sed` to remove `lang="ts"` attribute. test-chat-ui-dom: adds `svelte-preprocess@6.0.3` to the install so svelte.config.js (which imports vitePreprocess from @sveltejs/vite-plugin-svelte) can always load during tests. CLOSED — all gates green.

## AI Flaky tests
- e2e flaky across groups — re-run, don't chase. (NB the api-image digest-mismatch was fixed in #245.)

## Orchestration Mode
- [x] Mono-branch + cherry-pick
- Rationale: one packaging change + its app alias.

## UAT Management
- App unchanged (aliased to src) → no UAT surface. Validation: (a) `dist` contains preprocessed `.svelte` with NO `lang="ts"` in `<script>` (pack-time check) + `.d.ts`; (b) app builds + chat e2e green (app on src via alias); (c) `npm pack --dry-run` shows dist contents.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Worktree `tmp/chatui-package-dist` on `feat/chatui-package-dist`; ENV `feat-chatui-pkg`; ports API 9315, UI 5415, MAILDEV 1315.
  - [x] Read `packages/chat-ui/package.json` (exports/scripts), `tsconfig.json` (rootDir src/outDir dist, excludes .svelte), `Makefile` build-chat-ui (~597) + pack-chat-ui (~602), `ui/vite.config.ts`, and how `@sveltejs/vite-plugin-svelte` `vitePreprocess` is used in `ui/svelte.config.js`.

- [x] **Lot 1 — svelte-package preprocessed dist**
  - [x] Add `packages/chat-ui/svelte.config.js`: uses `vitePreprocess()` for DOM tests; build step uses temporary svelte-preprocess config.
  - [x] Add devDeps to `packages/chat-ui/package.json`: `@sveltejs/package@2.3.9`, `svelte-preprocess@6.0.3`. Keep `svelte` peer.
  - [x] Make `build-chat-ui` produce `dist/` via `svelte-package` (CLI: `svelte-package -i src -o dist`) with temp svelte-preprocess config + sed post-processing to strip `lang="ts"`. (BR-PKG-EX1: Makefile.)
  - [x] Repoint `packages/chat-ui/package.json` `exports` for ALL subpaths to `dist/`. Set `main`/`module`→`./dist/index.js`, `types`→`./dist/index.d.ts`. Set `files: ["dist"]`. Bump `version` 0.10.0 → 0.11.0.
  - [x] `chat-ui-reference-validation.json` dogfoodedBy paths stay `ui/src/...` — unchanged.
  - [x] Update `export-manifest.json` (`_version` 0.11.0 + dist file paths in `file` fields).
  - [x] Update `tests/export-surface.spec.ts` and `tests/chat-conversation.spec.ts` for dist-based exports and 0.11.0 version.

- [x] **Lot 2 — keep the app on src (zero app change) + validate**
  - [x] `ui/vite.config.ts`: regex alias `@sentropic/chat-ui` → `packages/chat-ui/src` (handles all subpaths).
  - [x] Pack-time dist sanity: `make pack-chat-ui` asserts no `lang="ts"` in dist/components/*.svelte + dist/index.js exists. PASS.
  - [x] `make typecheck-chat-ui` PASS
  - [x] `make build-chat-ui` PASS (svelte-package, preprocessed dist)
  - [x] `make pack-chat-ui` PASS (dist sanity green)
  - [x] `make test-chat-ui ENV=test-chatui-pkg` PASS (408/408)
  - [x] `make test-chat-ui-dom ENV=test-chatui-pkg` PASS (109/109)
  - [x] `make typecheck-ui ENV=feat-chatui-pkg` PASS (0 errors, 6 pre-existing warnings)
  - [x] `make lint-ui ENV=feat-chatui-pkg` PASS
  - [x] `make build-ui-image ENV=feat-chatui-pkg` PASS (app builds against src via alias)
  - [x] `make down ENV=feat-chatui-pkg` done

- [ ] **Lot N — Final**
  - [ ] All gates green; `enforce-package-bump` satisfied (0.11.0).
  - [ ] PR (this BRANCH.md as body), branch CI green (ALL; rerun e2e flakes). On merge, publish-chat-ui (now decoupled from e2e per #244) publishes the consumable 0.11.0.
  - [ ] Remove BRANCH.md, push, merge.

## ESCALATE (do not thrash) if:
- `svelte-package` can't be configured for the non-`src/lib` layout, or the dockerized build can't run it, or the dist structure doesn't match the exports — STOP and report the exact blocker with evidence; do NOT hack around it.
