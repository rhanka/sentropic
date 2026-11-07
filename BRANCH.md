# Feature: Repository-owned harness profiles

## Objective
- [ ] Enable sentbase and other repositories to own a strictly validated harness profile without changing the scope kernel.

## Scope / Guardrails
- [x] Owner packet: `.tmp/packets/harness-profile-file.md`; wagon `feat/harness-profile-file` from `origin/main` at `165ce5b93`.
- [x] Worktree: `tmp/worktrees/harness-profile-file`; test environment: `test-harness-profile-file`; no service ports required.
- [x] Make-only, Docker-first, no Python, no image builds, no attribution trailers; selective staging and `make commit` only.
- [x] No PR, version bump, lock regeneration or publish; integration lane assigns the wagon's version in the next dated train.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/harness/src/**`
  - `packages/harness/tests/**`
  - `packages/harness/schema/harness-profile.schema.json`
  - `packages/harness/README.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `package-lock.json`
  - `packages/harness/package.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare `BR99-EXn` with reason, impact and rollback before touching a conditional path.

## Feedback Loop
- [x] Owner requirements authorize the profile contract and precedence; preserve built-in C1/C2 behavior and advisory exit status.
- [ ] Track handoff: designated conductor imports the request, lots, deliverables and test receipts from this source; this lane does not append to the shared journal.
- [ ] Train handoff: consolidated independent review, version allocation, package qualification and CI belong to integration.

## AI Flaky tests
- [x] Deterministic unit/integration tests only; no accepted flaky cases.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** — one wagon, integrated and reviewed by the dated train lane.

## UAT Management (in orchestration context)
- [ ] CLI acceptance: load a Rust + Node profile, enforce Cargo.toml / .githooks/** / LICENSE restrictions, and reject invalid configuration with exit 2.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: mandatory reads, isolated worktree, mechanical `harness check branch`; reuse existing Node image only.
- [ ] **Lot 1 — Tests first**: new `tests/cli/profile-file.spec.ts` and `tests/profile/profile-file.spec.ts`; red evidence for loading, discovery, precedence, strict validation and built-in regression matrices.
- [ ] **Lot 2 — Profile format**: JSON Schema, typed validation errors, serializable built-ins, file loader and root discovery; no dependency changes.
- [ ] **Lot 3 — Kernel and CLI**: profile path defaults, BRANCH conventions, commit guards; shared resolver for check/verify/audit/init; targeted tests and typecheck.
- [ ] **Lot 4 — Documentation and handoff**: README Rust + Node example, scoped regressions, mechanical scope gate, push branch only, report `.tmp/rv/harness-profile-file.md`, remove test volumes.
  - `api/src/scripts/cm-preprod-*.ts`
  - `api/src/services/identity/cm-cutover-checkpoint.ts`
  - `api/src/services/identity/cm-import-source.ts`
  - `api/tests/unit/auth/cm-preprod-*.test.ts`
  - `deploy/ci/preprod-a4/**`
  - `deploy/ci/idp-identity-sync/idp-sync.selftest.mjs`
  - `deploy/ci/artifact-content/tests.mk`
  - `deploy/k8s/overlays/preprod/**`
  - `deploy/k8s/overlays/preprod-a4/**`
  - `docs/runbooks/preprod-a4-cutover.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/drizzle/*.sql`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml` under BR83-EX1
  - `Makefile` under BR83-EX2
  - `apps/auth-idp/tsconfig.json` under BR83-EX3
  - `e2e/tests/08-chat-workspace-switch.spec.ts` under BR83-EX4
  - `deploy/k8s/base/36-oauth-register-client-job.yaml` under BROJ-EX1
  - `plan/69-BRANCH_feat-ci-consumer-contracts.md` under BRTRAIN-EX1
  - `tools/memory-mcp-l5/artifacts/**` under BRTRAIN-EX2

## Feedback Loop
- [x] EXT06-W1 — Merge #929 with manual conflict union: retain train's social/registration admission and read-only session validation, add the wagon's post-commit remote-session authority, preserve both HTTP concurrency regression sets, and keep candidate-core archive output with chat-ui 1.0.1.
- [x] EXT06-W2 — Merge approved A4 procedure at 1a5a9ef98, retain both bundle commands; operator/API/manifest qualification follows; no live cutover execution.
- [x] EXT06-PIN — Six-line recovery image block with temporary removal comment; candidate build/publication unchanged. Local four-workload recovery and A4 renders PASS; production source unchanged. CI log receipt remains required.
- [x] EXT06-RUNTIME — Default preprod must keep the recovery entrypoint and omit unprovisioned A4 custody dependencies. Move A4 patches into an explicit preview overlay; the existing authorized wire operation still installs them under fence. Qualify both actual renders and keep all prior custody assertions.
- [x] EXT06-EX2 — Existing CI manifest target also qualifies A4/recovery renders and operator tests. Its digest fixture layers an image override over the actual pinned overlay, preserving every existing content assertion. Impact: read-only CI qualification only; rollback: restore the fixture recipe.
- [x] EXT06-EX1 — Extend scope to approved #929 and A4 wagon paths, including existing BR83-EX1 workflow union and BRA4B-EX1 Makefile include. Impact: requested train integration/preprod pin only; rollback: revert the two wagon merges and image block. Preserve versions, lock entries and existing pins except the wagon's chat-ui 1.0.1 version record.
- [ ] EXT06-CI — Independent consolidated review, local scoped gates, exact-head attempt-1 CI green, PR body and Extension 06/11 report; conductor remains the Track writer.
- [x] EXT06-REVIEW-F1 — Astra's single blocking finding resolved: restore #929's per-case DOCX workspace/folder fixture and initial GET/POST presence handshake. Retain the train's readonly assertions. Complete spec PASS 3/3 with WORKERS=1 RETRIES=0 on current candidate production images; independent closure GO. No timeout/retry increase.
- [x] EXT06-LOCK — Merge-required metadata alignment only: UI's local chat-ui record follows #929's 1.0.1 manifest/root record. No dependency resolution, lock regeneration or pin refresh; retained L5 verification passes unchanged.
- [x] EXT06-ZLIB / BRTRAIN-EX3 — Cold browser build proves Alpine v3.24 removed zlib 1.3.2-r1; apk policy/search identifies 1.4-r0 as its replacement. Exact replacement pin passes both browser/capture/video probes, serial DOCX and the unchanged security gate; no suppression or gate change.
- [x] EXT06-MUSL / BRTRAIN-EX3 — Scan reproduces HIGH CVE-2026-107891 in musl/musl-utils 1.2.6-r2; pin both to the scanner's fixed 1.2.6-r3. Final API/UI/E2E scans report zero findings, with unchanged compliance checks and no exception-register edit.
- [x] EXT06-CI1 — Run 42299724847 validate-idp-sync rejects the intentional parent-overlay transformation from replica-sync :main to recovery f2313a. Local Make replay reproduces the exact mismatch; corrected full selftest PASS 74/74. Compare every sync object strictly after applying only the declared parent image pin to the expected replica image; negative controls reject undeclared images and any CronJob activation. No runtime, source sync manifest, production image or gate change.
- [x] EXT06-NS — Full-resource namespace assertion reproduces the A4 preview runtime ConfigMap's absent namespace. Explicitly stamp the preview sentropic-preprod, like the ordinary overlay; require every resource in both renders to remain in that namespace. Authorized wire and production remain unchanged.
- [x] TRAIN-CI11 — Run 42258636361 shard 3: /auth/session returns 500 after session_validate activity writes exhaust unchanged serialization attempts (40001). Use CM's supported read-only session_validate completion while preserving all write flows/refusal mapping. Real current-session handler: 16 concurrent requests pass, activity row remains unchanged, invalid/revoked tokens return 401; complete concurrency suite 5/5 PASS. Before-fix HTTP fan-out happened to pass locally, but the retained deterministic activity-write assertion failed; CI retains the actual 500 evidence. No retry/deadline increase or E2E assertion change.
- [x] TRAIN-ASTRA1 — Reproduced UI-only dispatch failure with real API/UI tuples and CI's empty candidate input. Require qualified candidates only for library-boundary omissions; retain UI/shared tuple equality and reject unsupported omission claims. Real-workflow UI/shared PR/main, dependency-drift and unqualified-boundary negative controls PASS; wiring/contracts/tuple suites 72/72.
- [x] TRAIN-ASTRA2 — Positively identified documentation has its own no-consumer policy, including README files under tooling directories. Real README/docs/BRANCH paths with unchanged real manifests/tuples match the actual workflow filters and pass. Mixed unknown paths, executable files under docs/spec and missing mandatory consumers still refuse; wiring/classification/contracts suites 101/101 PASS.
- [x] TRAIN-ASTRA3 — Screen navigation carries the selected workspace; rendered form targets the authenticated bound workspace. Three regressions fail before correction, then grant/consent/workspace suites 11/11 PASS. Real requireAuth middleware selects workspace-B while the artifact is inaccessible in default workspace-A; form grant opens B without a loop. Tampered workspace and membership removal refuse with no grant; existing origin/version checks retained.
- [x] TRAIN-ASTRA4 — Independent closure exposed UI source plus BRANCH.md selecting full integration. Reproduced with real workflow/Make tuple inputs; ignore identified documentation when determining UI confinement. Also reproduce/fix scripts/README.md toolchain misclassification; unknown functional paths remain conservative. Final script regression suites 111/111 PASS.
- [x] TRAIN-CI10 — Run 42245247246 shard 5 fails 01-app.spec.ts:94: disabled-state URL assertion expects /organizations but receives /dashboard. The folders response selects the first seeded folder after the test reads the disabled class; normal Playwright click waits for activation before navigating. A controlled Chromium probe reproduces the stale snapshot failure and preserves the disabled negative control. Require enabled Dashboard navigation within two seconds before leaving /folders; keep every existing URL assertion and both state branches. Real scoped E2E: 5/5 PASS, zero skips/retries, on this run's verified API/UI image archives and the qualified Chromium image.
- [x] TRAIN-CI9 / BRTRAIN-EX3 — Run 42242515912 build-e2e: full Chromium starts but capture returns an empty-image protocol error. The title-only probe has no painted content in either channel. Render visible fixture content and require first-contentful-paint within 2000 ms before mandatory screenshot/video capture; additionally assert PNG signature. No retry or existing timeout change. Cold local build passes both Chromium 156 channels; exact protocol failure was not reproduced locally, while absent paint was deterministic. Trivy/compliance PASS with zero HIGH/CRITICAL findings; full CI receipt follows in the train report.
- [x] TRAIN-CI8 / BR83-EX1 — Run 42241084291 chat-core 695/695 PASS, chat-ui DOM 206/206 PASS; installed pair still names the old core 0.3.1 archive. Feed the guarded packer's tarball output into pair qualification so it validates the actual candidate. Scope: producer output/wiring only; no qualification or dispatch gate relaxed. Wiring 39/39 PASS; real installed UI 1.0.0/core 0.3.2 contracts, Svelte typecheck, Vite build and runtime/remount/permission matrix PASS.
- [x] TRAIN-CI7 — Run 42240457717 validate-chat-core: 694/695 PASS; only the durable-port release test still expects 0.3.1 after the required patch bump. Align its exact equality to 0.3.2, retaining the release identity assertion.
- [x] TRAIN-CI6 — Run 42237216892 shard 4 fails the unchanged workspace-B mention assertion at 04-tenancy-workspaces.spec.ts:183. Members arrive after @ input, but the comment state never refreshes mentionMatches. Deterministic delayed-response regressions fail for @ and a changed @bob query, then pass after recomputing matches on member arrival; a dismissed menu stays closed. Module suite: 32/32 PASS. Patch chat-core 0.3.2 exceeds published 0.3.1; root/UI workspace version records only, with no dependency re-resolution. Retained P1 manifest verification remains PASS (30 files, 54 edges); no new manifest generation needed.
- [x] TRAIN-CI5c — Selected/latest preparation prefers the guarded auth-ui receipt; selected consumer installs that peer and tuple alignment requires its exact manifest/lock contract. Unchanged strict sibling-integrity gates and full packed suite PASS (135/135, zero skips); publish the completed repair after the two prerequisite lock commits.
- [x] TRAIN-CI5b — Pin auth-ui 0.9.0 and its renderer peers in the selected consumer; verified published archive SHA-256 0ce478a6c2bf07e9a6edd972e70e8e18ec899cd403509fee30a3bb2b90ee42f7. Existing tuple pins unchanged; real packed qualification 135/135 PASS.
- [x] TRAIN-CI5a — Freeze the selected auth-ui compiler prerequisites from the committed dependency universe; preserve every existing version, URL and integrity. Complete local packed-consumer qualification: 135/135 PASS, zero skips; source/tuple regression: 20/20 PASS. Commit generated records in bounded parts before publishing the complete fix.
- [x] Owner continuation: push each verified fix and iterate until the entire train CI is green; no rerun, CI-skip marker, relaxed assertion, timeout/retry increase or merge.
- [x] TRAIN-CI4 — Reproduced five HTTP 503 responses among 16 concurrent new-account magic-link completions, with PostgreSQL SSI pivot errors (40001). Account creation reads the account-wide first-user predicate. Admit registration/magic-link/social completions through the existing exclusive writer gate before BEGIN, matching direct account creation; serializable isolation and all retry/deadline limits stay unchanged. Regression: 16/16 HTTP 200 with session tokens, accounts and admin workspace memberships; replay HTTP 400. Existing concurrency cases also PASS (4/4 tests total). Full CI/shard 6 confirmation pending.
- [x] TRAIN-CI3 — Shard 3 export readiness correction: retain the two-second dialog and ZIP assertions, require enabled state before a normal actionable click. Combined dashboard/matrix/checkpoint specs on the corrected image: 21/21 PASS, zero retries.
- [x] BRTRAIN-EX3 — Fix CVE-2026-85091: pin E2E zlib 1.3.2-r1, the Alpine fixed version. Impact: E2E runtime library only; rollback: restore prior pin while retaining the blocking security gate. Image build/browser/video probes PASS; Trivy zero HIGH/CRITICAL findings; no suppression or register exception.
- [x] TRAIN-CI2 — Share the auth-ui compiled-renderer fixture; preserve both resource cases and every assertion, without changing timeout/retry settings. make test-auth-ui: 56/56 PASS.
- [x] TRAIN-CI1 — Fix shard 4 on run 42157650191: observe the dashboard lock across presence replacement while retaining the fallback print-hidden requirement and requiring a disabled presence lock; await the post-restore response before checking the unchanged route-handler flag. Scope: the two named E2E specs only, authorized by the train fix request; no timeout/retry increases or assertion weakening. Deterministic Chromium probe reproduces both races and rejects missing print-hidden/enabled presence locks. Local specs 4/4 PASS; complete shard 4: 43 PASS, six existing declared skips, zero retries. Full PR CI remains pending the single fix push.
- [x] TRAIN-R1 — Missing worker-script CSP reproduced in four MIME vectors and Chromium 148; corrected application responses block external fetch/eval/Wasm while same-origin reads work. CSP 26/26 and content 79/79 PASS; safe mode and SVG/PDF sandbox preserved.
- [x] TRAIN-R2 — Bind JSON/form grants to the displayed scope version and reject missing/stale versions without granting a widened scope; regression 5/5 PASS after reproducing missing version binding.
- [x] TRAIN-R3 — Retain all core integration jobs and affected owners even when missing/unselected; broaden UI validation for API runtime changes under BR83-EX1. Two regression cases failed before the fix; consumer-contract fixtures 23/23 PASS.
- [x] TRAIN-R4 — Require existing UI build job identities and main-only deployment only on main; select IdP smoke for UI changes under BR83-EX1. Real-workflow UI/shared PR/main and API runtime cases pass; wiring fixtures 39/39 PASS.
- [x] BROJ-EX1 — #923 OAuth registration job workingDir only; reason: npm must run inside its package; impact: job startup; rollback: revert workingDir.
- [x] BR83-EX1 — #921 CI classifier/contracts/tuple dispatch; reason: prove omitted consumers unchanged; impact: CI selection/verdict; rollback: revert wagon workflow edits.
- [x] BR83-EX2 — #921 named Make entry points; reason: reproducible CI tooling gates; impact: tooling recipes; rollback: revert wagon recipes.
- [x] BR83-EX3 — #921 IdP tsconfig test include; reason: candidate-contract static coverage; impact: test inclusion; rollback: restore prior include.
- [x] BR83-EX4 — #921 inherited readiness-only E2E fix: focus row, require tabindex=0 within two seconds before click; reason: documented unregistered-row race; impact: one test; rollback: revert readiness lines. No timeout/retry increases.
- [x] BRTRAIN-EX1 — Retain #921 durable plan updates; reason: wagon traceability; impact: plan only; rollback: restore base plan.
- [x] BRTRAIN-EX2 — Refresh retained L5 P1 manifest/archives after committing integrated lock; reason: lock freshness; impact: generated evidence; rollback: restore prior artifact set with its lock.
- [ ] Track handoff: designated conductor imports this request, wagons, deliverables and acceptance receipts; this concurrent lane never appends `.track/events.jsonl`.

## AI Flaky tests
- [x] Deterministic failures block; provider exceptions require same-head evidence and explicit owner sign-off; none accepted here.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** — Five wagons, one train integration, consolidated review and exact-head PR CI; conductor owns final merge.

## UAT Management (in orchestration context)
- [ ] Qualify safe/application mode and reader grants on the exact train head using scoped tests and full PR CI; retain SHA and receipts in the report.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read common/master/workflow/testing rules, steward evidence and wagon plans; isolated worktree and mechanical branch gate.
- [x] **Lot 1 — Integration**: merge #923, then #921, then #924; keep this single plan and preserve implementation changes.
- [x] **Lot 2 — Artifacts**: check published version below 0.2.17; regenerate root/API/selected locks, selected archive integrity, APP-P1 digest and L5 P1 once through Make.
- [x] **Lot 3 — Scoped gates**: publishable wiring/classification, compatibility, consumer contracts, installed tuple; artifacts CSP/handler/MIME, content-host application mode, reader-grant/registry and selected packaging tuple tests.
- [x] Local receipts: compatibility 18/18, consumer contracts 23/23, installed tuples 10/10, publishable wiring/classification 59/59; `make test-artifacts SCOPE=tests/content-` 79/79.
- [x] Scoped host receipts through `.tmp/train/integration.mk`: application wrapper 4/4; API registry/grant/consent 33/33; selected tuple/preparation 24 passed with three installed-fixture-only tests deferred to full CI.
- [x] Final archive after review remediation: SHA-256 `08df842f9873356e8d0c1ed834763df0bc1160544c73f4883e4446db67a763d8`; selected integrity re-pinned through Make. Root/API lock refresh, APP-P1 digest and L5 generation were not repeated.
- [x] Integration receipt: APP-P1 `0725ef3044cf06b04eaae5f407cc364e8c3c8ef570b6835b9aa0038fb556f34b`; L5 `e46814a6678a1bc2b9aedff17c64a2eab522689f250b040134f5de96ad7cbb5c`, packed graph 30 files/54 edges PASS.
- [ ] **Lot 4 — Review and CI**: consolidated final-diff review, mechanical scope/branch gates; push review-ready head, open one READY PR, watch attempt 1 and fix evidenced root causes.
- [ ] **Lot 5 — Handoff**: report `.tmp/rv/train-2026-11-06.md`; clean test volumes; leave train unmerged and wagons open for conductor.
