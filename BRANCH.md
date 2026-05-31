# Fix: Embed the Cowork desktop Windows binary into the UI image (CI)

## Objective
Wire `make package-desktop-windows` into the CI `build-ui` job (mirroring `build-ext-vscode`) so the Cowork Windows `.exe`/zip is produced and baked into `ui/static/cowork-desktop/` of the deployed UI image. Without it, the admin download card (BR-41a) 404s because no artifact is ever built or hosted.

## Scope / Guardrails
- Scope limited to the CI `build-ui` job in `.github/workflows/ci.yml` (one added step).
- No Makefile change: `package-desktop-windows` already exists (BR-41a Lot 5) and cross-compiles entirely on Linux/Docker.
- No package `src/**` change → no version bump required.
- Artifact (`ui/static/cowork-desktop/**`) is gitignored, same as the chrome/vscode artifacts.
- Unsigned build for now (signing deferred: resold OV cert + jsign later); `package-windows.mjs` skips signing with a warning when `COWORK_SIGN_PFX` is absent.
- Make-only workflow, `ENV=<env>` last argument when any make command is run.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/ci.yml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**` → covered by `CDE-EX1`
- **Exception process**:
  - `CDE-EX1` declared in `## Feedback Loop`.

## Feedback Loop
- `CDE-EX1` — `acknowledge` — Path: `.github/workflows/ci.yml`. Reason: the entire fix is one added CI step in the `build-ui` job. Impact: adds the Cowork desktop binary build before the UI image build (same `if` as the chrome/vscode artifact steps). Rollback: revert the single added step; download card returns to its prior 404 state, no other CI behavior affected.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism; at least one success on the same commit/command; never add timeouts; if unrelated to this change, record command + file + signature here and capture user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single CI step, one final test cycle)
- [ ] **Multi-branch**
- Rationale: trivial CI-only change; no orthogonal sub-workstreams.

## UAT Management (in orchestration context)
- Mono-branch: UAT (download of the produced exe from a deployed Sentropic environment) happens post-merge on the user's locked-down test machine via the admin download card.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm `package-desktop-windows` exists on `origin/main` and cross-compiles on Linux (`packaging/package-windows.mjs`: esbuild → `@yao-pkg/pkg` node24-win-x64 → npm `--os=win32` prebuilds → zip to `ui/static/cowork-desktop/`).
  - [x] Confirm the CI `build-ui` job builds chrome+vscode but NOT the cowork binary, and `ui/static/cowork-desktop/` is gitignored (→ download card 404 in prod).
  - [x] Worktree `tmp/fix-cowork-desktop-embed` off `origin/main`; branch verified.
  - [x] No dev stack required (CI-only change). BR-41 reference slot ports: API 9205 / UI 5405 / Maildev 1305 (unused here).
  - [x] Validate scope; declare `CDE-EX1` for `.github/workflows/ci.yml`.

- [ ] **Lot 1 — Add the Cowork desktop build step to CI**
  - [x] Insert step `Build Cowork desktop binary` (`run: make package-desktop-windows`) in the `build-ui` job, right after `Build VSCode extension target` and before `Build UI image`, with the same `if` (`ui || global`).
  - [ ] Lot gate:
    - [ ] Push branch; PR with this `BRANCH.md` as body.
    - [ ] Verify the `build-ui` job's `Build Cowork desktop binary` step succeeds in CI and produces `ui/static/cowork-desktop/sentropic-cowork-windows-x64.zip` (cross-compile + native prebuild fetch on Linux). This is the first end-to-end run of `package-desktop-windows`; treat a real build failure as blocking (no silent fallback).
    - [ ] Confirm the rest of CI stays green (or document AI-flaky signatures + user sign-off).

- [ ] **Lot N — Final validation**
  - [ ] Verify branch CI green on the PR (resolve real failures; document AI flakes).
  - [ ] Record explicit user sign-off if any AI flaky test is accepted.
  - [ ] Final gate: once CI is OK, commit removal of `BRANCH.md`, push, and merge.
  - [ ] Post-merge: on the next main deploy, the download card serves the zip from the Sentropic origin (release channel) → user UAT of the exe on the locked-down test machine.
