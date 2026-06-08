# Feature: BR-38c (reconciled) — documents module rendering fold (ImageLightbox + MessageAttachments)

## Objective
Fold the two attachment-rendering components the modularization Lot 4 deliberately left app-local — the image lightbox and the per-message attachment thumbnails — into `@sentropic/chat-ui` `src/documents/`, host-callback-driven, closing the rendering gap of the documents module. Re-authored from current `main` (chat-ui 0.19.0); supersedes the pre-modularization `feat/38c-chat-ui-vision-defaults` (kept as local reference, never pushed).

## Scope / Guardrails
- Scope limited to `packages/chat-ui` (documents module + exports + tests + manifest). Package-only: NO app changes.
- AppChatPanel / `ui/**` MUST NOT be touched in this branch (owner + conductor directive; app dogfooding is a separate blocking follow-up sequenced via `codex:chatui-app-retrofit`).
- Zero sentropic domain strings in the module (scanned); all domain logic via `DocumentHost` / injected callbacks.
- Match the documents module conventions exactly: unprefixed component names, `.svelte.d.ts` per exported component, `./documents/*.svelte` export entries.
- Dedup rule: reuse `documents/attachmentState.ts` + `DocumentHost.resolveAttachmentSrc` — no parallel state/host modules (review DROP list applies).
- npm publish GATED on conductor ping (owner veto on public names) + verify npm `latest` actually moves post-merge.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-38c-documents-rendering`.
- Automated test campaigns run on dedicated environments, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/src/documents/**`
  - `packages/chat-ui/src/index.ts`
  - `packages/chat-ui/tests/**`
  - `packages/chat-ui/chat-ui-reference-validation.json`
  - `packages/chat-ui/export-manifest.json`
  - `spec/SPEC_EVOL_CHATUI_MODULARIZATION.md` (docs note: rendering gap closed)
- **Forbidden Paths (must not change in this branch)**:
  - `ui/**` (AppChatPanel collision guard — app dogfood is a separate follow-up)
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit `BR38c-EXn` exception)**:
  - `api/**`
  - `.github/workflows/**`
  - `packages/chat-ui/src/{components,state,hosts,stores,utils,client,renderers}/**` (outside documents/ — only if strictly required)
- **Exception process**:
  - Declare `BR38c-EXn` in `## Feedback Loop` with reason, impact, and rollback before touching any conditional/forbidden path.

## Feedback Loop
- `BR38c-D1` — `attention` (naming, publish-gating): lightbox public name split across reviewers — `ImageLightbox` (architect + owner x2) vs `AttachmentLightbox` (conductor). Implementation starts as `ImageLightbox.svelte` (majority); conductor holds npm publish for owner (rhanka) veto on final public names; pre-publish rename trivial if vetoed. `MessageAttachments.svelte` is consensus.
- `BR38c-D2` — `acknowledge` (deferred helper): `attachmentState.runComposerAttachmentUpload` SKIPPED in this PR per contract-consumer-codesign house rule (conductor + owner 23:15Z); re-propose during the app-dogfood follow-up if the real host proves the need (additive minor).
- `BR38c-B1` — `attention` (blocking child, NOT this PR): owner fidelity condition — the lot does not CLOSE until the app actually renders both components (AppChatPanel dogfood follow-up, sequenced through `codex:chatui-app-retrofit`; one owner edits AppChatPanel at a time). Track after merge+publish.
- `BR38c-N1` — `acknowledge` (adjacent, out of scope): open `LocalToolName` registry for host-defined tools (openerp finding, routed to chat lane) — separate deliverable; do not touch `stores/localTools` here.
- `BR38c-N2` — `acknowledge` (baseline note): the BRANCH.md present on `main` at branch creation is the PR #270 merge leak, removed by PR #271; overwriting it in this worktree is the normal flow, no impact.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on same commit + command).
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing file + signature; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Not expected to apply: package-only branch (no AI paths, no E2E changes).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single package fold, two components, one test cycle; no sub-workstreams.

## UAT Management (in orchestration context)
- Package-only branch: no app UAT in this branch. App UAT happens with the dogfood follow-up (`BR38c-B1`) on the new AppChatPanel seam.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/feat-38c-documents-rendering` created from `origin/main` `79e1462d3` (chat-ui 0.19.0, modularization complete; includes the #270 image-paste-freeze fix); branch verified.
  - [x] Review directives integrated (5 replies consolidated): GO now; fold ImageLightbox + MessageAttachments into `src/documents/`; DROP tray/projection/composer-state/web-attachment-host (superseded by AttachmentBand/attachmentState/DocumentHost); no AppChatPanel changes; publish gated.
  - [x] Read `documents/` module surface on main (index.ts, types.ts `DocumentHost`, attachmentState.ts, AttachmentBand.svelte with `onEnlarge(item, src)` hook).
  - [x] Environment mapping: ports API `8738`, UI `5138`, Maildev `1038`; `ENV=test-38c-documents-rendering` if a stack is ever needed (package gates are env-less isolated docker runs: `typecheck-chat-ui`, `test-chat-ui`, `test-chat-ui-dom`).
  - [x] Scope boundaries validated; `ui/**` forbidden (collision guard).

- [x] **Lot 1 — Fold rendering components into `src/documents/`**
  - [x] `packages/chat-ui/src/documents/ImageLightbox.svelte` (+ `.svelte.d.ts`): full-screen overlay (backdrop click, close button, Escape via window keydown, download link), `image: {src, alt} | null` + flat label props (`closeLabel`/`downloadLabel`, module convention) + `onClose`; image-only; inline SVG icons (no lucide, module convention); zero domain strings.
  - [x] `packages/chat-ui/src/documents/MessageAttachments.svelte` (+ `.svelte.d.ts`): sent-message attachment grid (image thumbnails + file download links), `attachments: ChatMessageAttachment[]` + `onResolveSrc` (SYNC callback mirroring `AttachmentBand.onResolveSrc`, fallback previewUrl→url) + `onEnlarge(src, alt)` + `enlargeLabel`; zero domain strings.
  - [x] Export entries `./documents/ImageLightbox.svelte` + `./documents/MessageAttachments.svelte` in `package.json` (types -> `.svelte.d.ts`) consistent with `./documents/AttachmentBand.svelte`; `export-manifest.json` updated with prop snapshots.
  - [x] Both components classified `primitive` in `chat-ui-reference-validation.json` (dogfoodedBy AppChatPanel — real import lands with `BR38c-B1`).
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui` green.
    - [x] **UI tests (TypeScript only)**
      - [x] Existing suites green with the new exports/manifest: `make test-chat-ui` — 760/760 (39 files; export-surface 120, reference-validation 98).

- [x] **Lot 2 — Fake-host harness + string scan**
  - [x] New `packages/chat-ui/tests/image-lightbox.dom.spec.ts` (jsdom, 8 tests): closed when `image=null`; overlay+img render; Escape calls `onClose` (and not when closed / non-Escape); backdrop + close button call `onClose`; custom `closeLabel`; download link `href`/`download`/`rel`.
  - [x] New `packages/chat-ui/tests/message-attachments.dom.spec.ts` (jsdom, 7 tests): empty list renders nothing; thumbnail via fake `onResolveSrc`; previewUrl→url fallbacks; placeholder when unresolvable; file download row; `onEnlarge(src, alt)` wiring; custom `enlargeLabel`. Zero sentropic strings in fixtures.
  - [x] Sentropic-string scan of `src/documents/` additions — CLEAN (grep `organization|folder|initiative|usecase|workspace|sentropic.|sent-tech`).
  - [x] Lot gate:
    - [x] `make test-chat-ui` green (760/760 node) + `make test-chat-ui-dom` green (149/149 jsdom, 11 files).
    - [x] `make typecheck-chat-ui` green.

- [x] **Lot N-1 — Docs consolidation**
  - [x] NOT APPLICABLE: `spec/SPEC_EVOL_CHATUI_MODULARIZATION.md` is NOT committed on `main` (verified absent from this worktree; it lives only in the owner's local root workspace) — updating it belongs to the modularization owner's lane. Components self-document via `.svelte.d.ts` + `export-manifest.json` prop snapshots; `BR38c-B1` tracks the app-dogfood follow-up here.

- [ ] **Lot N — Final validation**
  - [x] Typecheck (`make typecheck-chat-ui`) + retest node (`make test-chat-ui` 760/760) + retest dom (`make test-chat-ui-dom` 149/149).
  - [x] Bump `packages/chat-ui/package.json` minor `0.19.1` -> `0.20.0` (+ `export-manifest.json` `_version`; + the 3 version-pinned test assertions per established pattern) — `enforce-package-bump` gate satisfied.
  - [ ] Final gate step 1: create PR using `BRANCH.md` as PR body; report branch name + test counts to conductor (h2a).
  - [ ] Final gate step 2: branch CI green; resolve blockers.
  - [ ] Final gate step 3: merge after CI green; npm publish HELD until conductor ping (`BR38c-D1` name veto); after publish verify npm `latest` moved.
  - [ ] Post-merge: open `BR38c-B1` follow-up coordination with `codex:chatui-app-retrofit` (app dogfood; lot closes only then).
