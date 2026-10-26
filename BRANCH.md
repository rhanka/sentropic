# Feature: W1.b app artifact composition and current authority

## Objective
- [x] Compose APP-P1 with durable app policy, opaque workspace scopes and one guarded HTTP/MCP effect path.

## Scope / Guardrails
- [x] Owner dispatch: W1.b, plan-v2 lines 128–147; tests first, draft PR only, no merge or deployment.
- [x] Worktree `tmp/worktrees/app-w1b`, branch `feat/app-cm-w1b`; base W1.a #773 `139729e9935c29112c7827d4684c79135404994f` (Opus APPROVE r2).
- [x] Main `ab981b16d` merged without rebase in `6ea8798a0`; artifacts 0.2.1 / mesh 0.22.4 inherited, no package/lock authoring.
- [x] Make-only; shared Docker flock for build/start/test, matching down after every step; `ENV=test-app-w1b` last.
- [x] API/UI/Maildev UI ports 8792/5178/1085 checked free before startup; no owner stacks touched.
- [x] Preserve W1.a migration authority and SQL hashes; W2.b alone reconciles final locks and physical image resolution.
- [x] Atomic authored commits below 150 lines, selective staging, scope-check and make commit; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/composition.ts`
  - `api/src/services/artifacts/authorization.ts`
  - `api/tests/api/artifacts-host-publication.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/**`
  - `.track/**`
  - `api/src/db/**`
  - `api/drizzle/**`
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Exception process: declare BR01-EXn with reason, impact and rollback before expansion.

## Feedback Loop
- [x] BR01-EX1: owner requires merge of main after W1.a, never rebase. The ancestry-only merge inherits 247 upstream paths; no authored merge resolution except retaining W1.a BRANCH.md. Its scope-check reported inherited paths; subsequent authored changes use the four-path scope above. Atomic limit applies to authored deltas; upstream history stays intact.
- [x] PR targets `feat/app-cm-integration` as dispatched. Deviation: #773 currently targets main for CI; W1.b retains the integration destination and uses workflow_dispatch if its base does not trigger PR CI.
- [ ] W0-close.e acceptance and W1.c/UP-T activation remain external gates; this lot activates no route or reader.
- [ ] W2 binds verified transport identity and a current credential check on the coordinator transaction; credential verification must never come from tool/body arguments.
- [ ] Independent review: automatic approval review rejected the Claude/h2a launch because private source would reach an unverified gateway without destination/payload authorization. No reviewer verdict exists; dossier `.tmp/app-w1b-review/dossier.md` at the root checkout. Owner approval is required before external review; no retry through another execution path.
- [x] HTTP-1: the focused red test returned HTTP 201 for a caller body scope equal to the verified scope, while MCP returned 400. Root cause: the upstream trusted HTTP app permits that field. Validate selected public POST bodies through the same compiled profile before authority/storage; map typed profile errors safely. Red `/tmp/app-w1b-closed-input-red.log`; final 16/16 green plus typecheck/lint `/tmp/app-w1b-closed-input-green.log`.
- [x] Superseded CI https://github.com/rhanka/sentropic/actions/runs/40411129496 on `7a6e6138a` was cancelled only after HTTP-1 reproduction; the corrected pushed head requires a new exact-head run. No successful CI receipt is claimed for that attempt.

## AI Flaky tests
- [x] No AI tests, accepted flakes or increased timeouts.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one code author on the app integration train; upstream changes integrated by merge only.

## UAT Management (in orchestration context)
- [x] Backend-only composition; web, Chrome and VSCode remain for W2/W4/W5; no root UAT stack.

## Plan / Todo (lot-based)
- [x] Lot 0: read Docker lock, whole plan, APP-P1 freeze, MASTER/workflow/testing/API rules and template; mechanical branch check.
- [x] Lot 1: `api/tests/api/artifacts-host-publication.test.ts` first: HTTP/MCP identity and replay parity, ensure/publish, foreign authority, APP-P1 refusal. Red run failed on the missing composition module before implementation; `/tmp/app-w1b-red.log`.
- [x] Lot 2: `authorization.ts`: current tenant/workspace/account/credential participants, post-wait rechecks and transactional quota; `composition.ts`: scoped PG store/KV/coordinator and shared transports.
  - [x] Implement transaction-bound current authority, explicit read/write credential permissions, provisional cumulative byte quota and request fences in `authorization.ts`.
- [x] Lot 3: same test file covers revocation after lock waits, DB-time expiry after quota/receipt waits, quota contention/rollback, guarded replay, version witness and no new durable success on denial; first full run 10/10 passed.
  - [x] Add independent read/write credential permissions, viewer downgrade, disabled/forged identity, foreign artifact metadata denial and frozen APP-P1 digest/file-limit cases.
- [x] Lot 4: API typecheck passed, lint 0 errors/219 warnings; final 16 publication + 16 host migration + 16 cluster migration + 11 tenant resolver cases passed, no final skips; healthy HTTP 200 logs and empty Compose ps after down. Every authored hunk reviewed by the author; no independent approval is claimed.
  - [x] Receipts: `/tmp/app-w1b-final-checks.log` (45 tests including 13 host cases), `/tmp/app-w1b-authority-regressions.log` (final 15 host + 11 tenant cases), `/tmp/app-w1b-runtime-scope-cleanup.log` (PASS C2, healthy logs, cleanup/empty ps). Optional multi-path readlink probe failed on BusyBox's single-file usage; physical dependency qualification remains W2's gate.
- [ ] Lot 5: exact BRANCH.md draft PR body, push, green exact-head CI and W1.d/W2 handoff; do not merge. External review remains the explicitly blocked gate above.
- [x] W1.d handoff: consume durable preparation intents, blob pins/references and upstream bounded cleanup/GC through separate host-maintenance authority; add recovery/restore proof. This lot starts no jobs or activation and uses no production memory fallback.
- [x] W2 handoff: validate selected transport inputs before `bind` provisions scope metadata; bind one verified subject/tenant/client/credential tuple across HTTP/MCP; supply the current transaction-bound credential reader with independent read/write scope permissions and explicit initial quota; compile/mount one registry path; reconcile API/root workspace locks and physical artifacts instances; retain existing MCP/resource/namespace/gateway/D1 regressions.

## Inherited main qualification record

> # Feature: Decision Q1 live qualification smoke
>
> ## Objective
> - [ ] Record bounded live protocol and identity evidence for JEV and OpenAI Decisions; keep production refused pending OD-4 calibration.
>
> ## Scope / Guardrails
> - [x] Owner GO dated 2026-10-29; spec v4 section 7.4; H1/H2 base `213638676`.
> - [x] Worktree `tmp/worktrees/decision-q1`, branch `feat/decision-q1-live`, mono-branch.
> - [x] Make only; no Python; secrets enter Compose from the existing root `.env` without copying values.
> - [x] Maximum three attempts per candidate, counting failed, refused and ambiguous calls; no retries.
> - [x] Local qualification only, `ENV=test-decision-q1` last; API 8802, UI 5202, Maildev 1102.
> - [x] Serialize Docker with `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; run `make down` afterward.
>
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `spec/decision/**`
>   - `packages/llm-mesh/src/decision/descriptor.ts`
>   - `packages/llm-mesh/src/decision/openai-descriptor.ts`
>   - `packages/llm-mesh/src/decision/descriptor-validation.ts`
>   - `packages/llm-mesh/package.json`
>   - `package-lock.json`
>   - `packages/llm-mesh/tests/decision-public-surface.test.ts`
>   - `packages/llm-mesh/tests/decision-jev-v4l3.test.ts`
>   - `packages/llm-mesh/tests/decision-qualification-admission.test.ts`
>   - `packages/llm-mesh/tests/decision-qualification.test.ts`
>   - `packages/llm-mesh/tests/decision-jev-request.test.ts`
>   - `packages/llm-mesh/tests/decision-openai-routing.test.ts`
>   - `packages/cluster-mesh/tests/fixtures/train.ts`
>   - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
>   - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `.cursor/rules/**`
>   - `api/**`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `.github/workflows/**`
>
> ## Feedback Loop
> - [x] No calibration authorized; live observations cannot qualify immutable weights, billing beyond the admitted bound, or production readiness.
> - [x] Q1-CRED-01: JEV preflight refused peripheral whitespace; normalized transiently after Compose injection, source env unchanged; refusal consumes attempt 1.
> - [x] Q1-INV-01: parser previously forbade observed IDs with unqualified production status; permit evidence inventory while retaining admission gates; regression keeps nonempty IDs and proves production refusal.
> - [ ] Q1-REV-01: conductor to select two exact complementary reviewer models before merge; h2a discovery has host presence but no model identities, no configured gateway catalog; no consensus claimed.
> - [x] Q1-CI-01: reproduced job 123314702961's three stale-version failures; rebound independent train and selected fixture to llm-mesh 0.32.2 and guarded archive SHA-512; 1,228 cluster-mesh tests and scope pass, 138 expected skips; see `spec/decision/q1-2026-10-29/ci-repair.md`.
>
> ## AI Flaky tests
> - [x] No flaky acceptance or additional live calls beyond the cap.
>
> ## Orchestration Mode (AI-selected)
> - [x] Mono-branch; no integration from other branches.
>
> ## UAT Management (in orchestration context)
> - [x] API-only qualification fixture; no UI, Chrome or VSCode surface change.
>
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Baseline and constraints**
>   - [x] Read master/workflow rules, spec section 7.4, API host and descriptors; mechanical branch check passed.
>   - [x] Verify ports, credential names, control pricing and isolated stack.
> - [x] **Lot 1 — Bounded live evidence**
>   - [x] Fix a public synthetic binary criterion and retain only that fixture input.
>   - [x] No documented zero-cost Decisions entitlement probe established; first POST counts as attempt 1.
>   - [x] Record served identity, tokens, priced cost, billing bound, latency, verdict shape and refusals per attempt.
>   - [x] Fail closed on descriptor identity mismatch; three calls per candidate including the JEV preflight refusal, five egresses total, 77 micro-USD.
> - [x] **Lot 2 — Evidence and descriptors**
>   - [x] Retain scrubbed receipts in `spec/decision/`; accepted identities/evidenceRefs cite only observed results.
>   - [x] Bump llm-mesh from published 0.32.1 to 0.32.2; align workspace lock and public version assertion.
>   - [x] Preserve unqualified production and OD-4 calibration requirement; 16 host/route tests pass.
> - [ ] **Lot 3 — Final validation and draft PR**
>   - [x] Mesh descriptor, qualification, adapter, pricing, public and request suites: 88 files / 1,566 tests pass.
>   - [x] llm-mesh typecheck/lint and mechanical scope checks pass; commits at most 150 lines.
>   - [x] Secret scan, attempt counts, identity comparison and durable 77 micro-USD ledger verified; zero reserved/pending.
>   - [x] Stop local stack with `make down`; publish report `spec/decision/q1-live-smoke.md`.
>   - [x] Draft PR #834 created against main; exact-head CI remains the final checkpoint.
>   - [ ] Observe CI completed/success on exact head; report head, 77 micro-USD and candidate outcomes.
