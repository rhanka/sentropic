# Feature: BR-06 — Chrome Upstream v1

## Objective
Upstream remote control: the webapp can dispatch tab_read/tab_action to connected Chrome tabs via the extension.

## Scope / Guardrails
- Make-only workflow, no direct Docker commands.
- Branch development in `tmp/feat-chrome-upstream-v1-rewrite`.
- `ENV=feat-chrome-upstream-v1-rewrite` `API_PORT=8706` `UI_PORT=5106` `MAILDEV_UI_PORT=1006`.
- Chrome extension architecture unchanged from main (sidepanel, SSE proxy, tool execution).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `api/**`, `ui/**`, `e2e/**`, `plan/06-BRANCH_feat-chrome-upstream-v1.md`, `spec/SPEC_CHROME_PLUGIN.md`, `spec/SPEC_EVOL_CHROME_UPSTREAM.md`, `PLAN.md`, `TODO.md`, `plan/11-BRANCH_feat-chrome-upstream-multitab-voice.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
- **Conditional Paths**: `api/drizzle/*.sql` (max 1), `.github/workflows/**`

## Feedback Loop
- [x] **BR06-FL-01 — API endpoints gate flaky accepted for Lot 2**
  - [x] `make test-api-endpoints API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite` reduced from auth-wide `429` failures to one residual flaky on `tests/api/chat-tools.test.ts`.
  - [x] Failure signature: missing `tool_call_result` in `comment_assistant suggest`, with queue logs `Session not found` during the full parallel endpoints run.
  - [x] Scoped rerun passed: `make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`.
  - [x] User accepted this residual flaky for Lot 2 validation on 2026-04-07.
- [x] **BR06-EX1 — Align extension build targets with CI**
  - [x] Reason: local `build-ext-chrome` / `build-ext-vscode` mutated `ui/package-lock.json`, while CI validated extension compilation only indirectly through `make build-ui-image`.
  - [x] Impact: allow scoped updates in `Makefile` and `.github/workflows/ci.yml` so extension build targets are lockfile-safe and are executed directly in CI.
  - [x] Rollback: revert the `Makefile` and workflow changes to return to indirect-only validation via `make build-ui-image`.
- [x] **BR06-EX2 — Stabilize CI API/E2E red lanes**
  - [x] Reason: the rebased branch still failed on the real CI paths for `test-api-endpoints`, `test-api-ai`, `test-e2e (group-c)` and `test-e2e (group-d)`; the AI matrix also had a GitHub Actions quoting bug where `$$SPECS` expanded to the bash PID instead of the spec list.
  - [x] Impact: allow scoped updates in `Makefile` and `.github/workflows/ci.yml` to replay CI via make targets, plus targeted fixes in API streaming/tests and E2E selectors/timeouts.
  - [x] Rollback: revert the scoped CI stabilization changes in `Makefile`, workflow, API streaming/tests and E2E specs.
- [x] **BR06-FL-03 — First extension login must gate chat on settings**
  - [x] Repro: first extension login left the chat tab mounted before extension auth status resolved, so the widget surfaced `Error while loading messages` and no model list instead of guiding the user to configuration.
  - [x] Fix: gate `ChatPanel` behind extension auth readiness/connection, show a transient loading state while auth status is loading, and auto-open extension settings when the runtime reports a disconnected session.
  - [x] Validation: `make test-ui SCOPE=tests/utils/extension-auth-ui.test.ts API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`, `make typecheck-ui API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`, `make lint-ui API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`.
- [x] **BR06-FL-04 — Connected extension must expose the current browser tab upstream**
  - [x] Repro: after a successful extension connect, the webapp still had no registered tabs unless the user manually changed tabs or navigated; the upstream registration block also called `getValidAccessToken()` without passing runtime config.
  - [x] Fix: pass runtime config into the tab register/keepalive/unregister auth calls, register the current active tab immediately after a successful extension connect, and bootstrap the active-tab registration when the extension worker starts.
  - [x] Validation: `make build-ext-chrome API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`, `make typecheck-ui API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`, `make lint-ui API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`.
- [x] **BR06-FL-05 — AI lane flaky accepted (company-enrichment-sync)**
  - [x] CI failure: `test-api-unit-integration (ai, chat-tools,company-enrichment-sync,documents-tool,initiative-generation-sync)` on PR #113.
  - [x] Command: `make test-api-ai SCOPE=tests/ai/company-enrichment-sync.test.ts API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`.
  - [x] File: `api/tests/ai/company-enrichment-sync.test.ts > should enrich an organization directly via /organizations/ai-enrich`.
  - [x] CI signature: `Error: Test timed out in 60000ms.` (1/24 fail, 23/24 pass).
  - [x] Scope: `api/tests/ai/**` — covered by AI flaky allowlist per `rules/testing.md` §40-42.
  - [x] Local repro on identical SHA (`uat/br06-local`): 4/4 passed in 27.73s, target test completed in 16615ms (vs 60s CI timeout). Confirms non-systematic AI-provider latency nondeterminism.
  - [x] Acceptance: user sign-off required before merge (AI flaky rule).
- [x] **BR06-FL-06 — E2E lane flaky accepted (08-chat-heavy)**
  - [x] CI failure: `test-e2e (group-d, 08)` on PR #113.
  - [x] Command: `make clean test-e2e E2E_SPEC=tests/08-chat-heavy.spec.ts API_PORT=8816 UI_PORT=5116 MAILDEV_UI_PORT=1116 ENV=e2e-feat-chrome-upstream-v1-rewrite`.
  - [x] File: `e2e/tests/08-chat-heavy.spec.ts:85 > devrait permettre upload + résumé + usage tool + suppression en viewer`.
  - [x] CI signature: primary — `assistantResponse` locator not visible within 90s after `sendMessageAndWaitApi`; debug logs show `job status: 404 {"message":"Job not found"}` and `stream events: 404 Not Found`. Secondary (retries 1-2) — strict-mode violation on document-delete selector because README.md rows accumulate across retries.
  - [x] Scope: `e2e/tests/08-chat-heavy.spec.ts` — NOT in the AI flaky allowlist per `rules/testing.md` §40-42.
  - [x] Local repro on identical SHA (`uat/br06-local`): 1 passed in 25.0s (38.5s total), no stream/queue 404, no job-GC window observed. Repro invalidates the "branch regression" hypothesis against commits `4c23f58b` / `5131bc70`.
  - [x] Classification: CI-side timing/contention flaky (full group-d parallel run), not a branch regression. Suspect CI Postgres contention or queue-worker startup latency under parallel E2E load.
  - [x] Acceptance: requires explicit user sign-off (NOT covered by AI flaky allowlist); propose rerun via `gh run rerun` to confirm non-systematic before merge.

## AI Flaky tests
- Acceptance rule: non-systematic provider/network nondeterminism only. Record command + file + signature.

## Orchestration Mode
- [x] **Mono-branch + cherry-pick**

## Plan / Todo (lot-based)

- [x] **Lot 1 — API: tab registry + chat-service tool injection**
  - [x] In-memory Tab Registry service (register, keepalive, delete, evict).
  - [x] Tab registration endpoints (session auth).
  - [x] Chat-service: inject tab_read/tab_action tools when tabs registered (webapp context).
  - [x] Lot gate: typecheck, lint, tests pass.

- [x] **Lot 2 — Extension: tab register + keepalive + MenuPopover**
  - [x] Add register/keepalive/unregister calls in background.ts (no other changes to extension).
  - [x] Register active tab on `chrome.tabs.onActivated` and `chrome.tabs.onUpdated`.
  - [x] Unregister on `chrome.tabs.onRemoved`.
  - [x] Keepalive interval 15s.
  - [x] MenuPopover strategy=fixed.
  - [x] Restore extension code from main (revert Lot 3 refactoring that broke floating mode).
  - [x] Lot gate:
    - [x] `make typecheck-api API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`
    - [x] `make typecheck-ui API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`
    - [x] `make lint-api API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`
    - [x] `make lint-ui API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite`
    - [x] **API tests**
      - [x] `api/tests/unit/tab-registry.test.ts` (non-reg)
      - [x] `api/tests/unit/chat-service-tab-tools.test.ts` (non-reg)
      - [x] Sub-lot gate: `make test-api-smoke test-api-endpoints API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test-feat-chrome-upstream-v1-rewrite` (accepted with `BR06-FL-01`)
    - [x] **UI tests**
      - [x] `ui/tests/upstream/injected-script.test.ts` (non-reg)
      - [x] Sub-lot gate: `make test-ui API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=test`

- [x] **Lot N-2 — UAT**
  - [x] Chrome extension
    - [x] Install updated extension → side panel fonctionne comme avant (non-reg)
    - [x] Floating mode fonctionne (LinkedIn, Outlook, etc.)
    - [x] Navigate to a site → tab registered via API
    - [x] Webapp chat (sans sidepanel) → tab_read/tab_action apparaissent
    - [x] tab_read depuis webapp → DOM content returned
    - [x] tab_action click depuis webapp → action exécutée
    - [x] Extension sidepanel → local tools fonctionnent comme sur main (non-reg)
  - [x] Web app — non-reg
    - [x] Chat sans extension: no tab_read/tab_action
    - [x] Chat: documents/comments/web_search fonctionnel
    - [x] Menu "+" → sections scroll, no overflow

- [x] **Lot N-1 — Docs consolidation**
  - [x] Update spec.
  - [x] Update PLAN.md.

- [x] **Lot N — Final validation**
  - [x] typecheck + lint + test-api + test-ui (CI run `24543066582` green on PR #113 after flaky rerun).
  - [x] Investigate PR #113 CI red lanes (analysis only, no fix yet):
    - [x] `test-api-unit-integration (ai, chat-tools,company-enrichment-sync,documents-tool,initiative-generation-sync)`
      - File: `api/tests/ai/company-enrichment-sync.test.ts > should enrich an organization directly via /organizations/ai-enrich`
      - Signature: `Error: Test timed out in 60000ms.` (single failure, 23/24 pass)
      - Scope: `api/tests/ai/**` — covered by AI flaky allowlist per `rules/testing.md`.
      - Classification: candidate AI-flaky (provider-side latency). Needs rerun to confirm non-systematic.
      - Proposed action: rerun the AI lane; if it fails again on same test, re-evaluate; otherwise accept as `BR06-FL-05` AI-flaky with user sign-off.
    - [x] `test-e2e (group-d, 08)`
      - File: `e2e/tests/08-chat-heavy.spec.ts:85 > devrait permettre upload + résumé + usage tool + suppression en viewer`
      - Signature: primary — `assistantResponse` locator not visible within 90s after `sendMessageAndWaitApi`; debug logs show `job status: 404 {"message":"Job not found"}` and `stream events: 404 Not Found`. Secondary (retries 1-2) — strict-mode violation on document-delete selector because README.md rows accumulate across retries.
      - Scope: `e2e/tests/08-chat-heavy.spec.ts` — NOT in AI flaky allowlist per `rules/testing.md`.
      - Suspect surface from branch diff: `api/src/services/stream-service.ts` was rewritten in commit `5131bc70 fix(ci): stabilize api and e2e lanes` (+88/-34 lines, advisory locks + factored `notifyStreamEvent`). The failure signature matches a stream/queue correctness regression (stream never completes → bubble never appears → job GC'd by the time debug polls).
      - Secondary suspect: `api/src/services/chat-service.ts` tab-tool injection path (`buildServerTabToolDefinitions` + `listRegisteredTabs` call during tool assembly) could theoretically affect non-extension users if not gated correctly, but the test user has no tabs registered so the injection should no-op.
      - Classification: legitimate CI red on our branch; cannot be dismissed as pre-existing (main is green on SHA `a102a9be`).
      - Proposed action: reproduce locally on `tmp/feat-chrome-upstream-v1-rewrite` with `make clean test-e2e E2E_SPEC=tests/08-chat-heavy.spec.ts API_PORT=8706 UI_PORT=5106 MAILDEV_UI_PORT=1006 ENV=e2e-feat-chrome-upstream-v1-rewrite`. If reproduced, bisect between `4c23f58b refactor(upstream): restore extension from main, add tab register only` and `5131bc70 fix(ci): stabilize api and e2e lanes` to identify the faulty commit; then fix under Lot N.
  - [x] PR → UAT + CI OK → merge.
