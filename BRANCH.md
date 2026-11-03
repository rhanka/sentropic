# Feature: Tenant bootstrap of the email-code HMAC secret (Q-K=A custody r2)

## Objective
- [x] Build the tenant-side sections of binding method `.tmp/cm-identity-agents/qk-secret-custody-r2.md` (sha256 1dcfb24d…, r2 2026-11-02, approved by Argon GO and k8s technical ACK with conditions C1–C5): (1) the reviewed `make` generation target + `gh secret set` stdin deposit, (2) `.github/workflows/email-code-hmac-secret.yml`, (3) the keyed-fingerprint / test-vector rotation and restore checks, (4) `docs/secrets.md` section + runbook + `deploy/k8s/README.md` pointer. No real key is generated and no workflow is run against preprod/prod; the conductor triggers generation after review.

## Scope / Guardrails
- [x] Owner decision Q-K = A (2026-11-02), carried to k8s; owner GO given directly to k8s on 2026-11-02. Binding method: qk-secret-custody-r2.md sha256 1dcfb24d…; k8s platform acts DONE (poc-k8s 1bb6b4e: writer SA/Role per tier, empty Secret shell `email-code-hmac` in `sentropic-preprod` and `sentropic`, VAP `email-code-hmac-single-writer`, K7 proven, registry entry preprod-cred-governance.md#email-code-hmac-writer). Writer kubeconfig already deposited as GitHub environment secret `KUBE_CONFIG_DATA_EMAIL_CODE_HMAC` in `sentropic-idp-run` (preprod) and `sentropic-idp-prod` (prod); `.env` source names `K8S_EMAIL_CODE_HMAC_WRITER_{PREPROD,PROD}_KUBECONFIG_B64` + `_TOKEN_EXPIRES`; token expires 2027-02-01T00:12:16Z.
- [x] Secrets are read by NAME only; no value is ever printed, logged, echoed or committed. Names only in all artifacts.
- [x] No Python. Node `.mjs` under `deploy/ci/email-code-hmac/` only. English everywhere.
- [x] Worktree `tmp/worktrees/qk-bootstrap`; branch `feat/qk-email-code-hmac-bootstrap` from origin/main `5b1d1dcd2`; `harness check branch` PASS C1.
- [x] Make-only, Docker-first; single Docker lock `.tmp/packets/DOCKER-LOCK.md` taken per command (`flock <lock> make ...`); reuse pinned `node:24-bookworm-slim` image already present locally; no new image build; `ENV=test-*` last, never `ENV=dev`; `make down ENV=<test-env>` after test lanes.
- [x] Tests: `make test-email-code-hmac-selftest ENV=test-email-code-hmac` (offline, no cluster, no gh) with dry-run and no-print assertions (K2/K3). One CI run on the final PR head only; never `[skip ci]`; PR stays READY (not merged).
- [x] Commits: `make commit MSG="..."` only, selective staging, ≤150 lines per commit; `make scope-check` before every commit; push after every commit (crash-safety rule).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/ci/email-code-hmac/**` (new: `custody.mjs`, `materialize.mjs`, `custody.selftest.mjs`)
  - `docs/secrets.md`
  - `docs/runbooks/email-code-hmac-cred-cycle.md` (new runbook + living registry)
  - `deploy/k8s/README.md` (one pointer entry in the secret-bundle section)
  - `BRANCH.md`
  - `docs/runbooks/app-artifact-content-infrastructure.md` (BR01-EX4, docs-only review-r1 fix)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`, `apps/**`, `packages/**`, `ui/**`, `e2e/**` (app-side wiring of §3.3 belongs to the A2.0b/A4 implementation lots, not this custody bootstrap)
  - `deploy/ci/idp-identity-sync/**`, `deploy/k8s/base/**`, `deploy/k8s/overlays/**` (k8s platform acts are DONE out-of-band; no manifest changes here)
  - `.github/workflows/ci.yml` (no CI rewiring; the new workflow carries its own selftest gate job)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` — see BR900-EX1
  - `.github/workflows/**` — see BR900-EX2
- **Exception process**:
  - BR900-EX1 and BR900-EX2 declared below in `## Feedback Loop` before touching those paths, with reason, impact and rollback.

## Feedback Loop
- [x] **BR900-EX1 — `Makefile` (forbidden by default)**: add the reviewed `email-code-hmac-*` targets and `test-email-code-hmac-selftest` next to the existing secret/selftest targets. Reason: method r2 §2.1 mandates that generation and rotation bookkeeping run only through reviewed `make` targets; the tenant bootstrap cannot exist without them. Authority: owner GO Q-K=A given to k8s on 2026-11-02 over binding method qk-secret-custody-r2.md (sha256 1dcfb24d…), §2.1/§7. Impact: additive targets only, no existing target modified; `test-idp-sync-selftest` and all other gates unchanged (its Makefile-content assertions still pass). Rollback: drop the added target block; no other file depends on it.
- [x] **BR900-EX2 — `.github/workflows/**` (conditional by default)**: add one new file `.github/workflows/email-code-hmac-secret.yml`. Reason: method r2 §3.2 pins this exact workflow file as the single writer of Secret `email-code-hmac` values. Authority: same owner GO (Q-K=A via k8s, 2026-11-02). Impact: new file only, `workflow_dispatch` only, `permissions: contents: read`; no existing workflow edited; it never creates/lists Secrets and never prints values. Rollback: delete the file; the pre-created empty shell and VAP remain valid (k8s acts are independent).
- [x] k8s-noted readers recorded in runbook §1.3/§5.3 as measured facts (C3): `sentropic-admin` (kubernetes-admin) and the kube-system controllers hold admin/cluster rights; `ci-deployer` both tiers, `sentropic-preprod` `edit` binding in preprod — residual read risk, out of scope for narrowing, recorded by name only.
- [x] Writer kubeconfig renewal documented: renew before 2027-02-01T00:12:16Z (token expiry), same mint → `.env` (`K8S_EMAIL_CODE_HMAC_WRITER_{PREPROD,PROD}_KUBECONFIG_B64`) → GitHub deposit (`KUBE_CONFIG_DATA_EMAIL_CODE_HMAC`) path; pointer to k8s governance entry preprod-cred-governance.md#email-code-hmac-writer.

## AI Flaky tests
- [x] Deterministic offline selftests only; no AI flaky exception.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: single bootstrap lane, one READY PR against main; no merge (conductor triggers the real generation after review).
- Rationale: one cohesive custody tool + workflow + docs; no orthogonal sub-workstreams.

## UAT Management (in orchestration context)
- [x] No UI surface; the offline selftest target plus one PR CI run are the applicable gates.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, method r2 end to end.
  - [x] Worktree `tmp/worktrees/qk-bootstrap` on `feat/qk-email-code-hmac-bootstrap` from origin/main; `harness check branch` PASS C1.
  - [x] BRANCH.md from `plan/BRANCH_TEMPLATE.md` with BR900-EX1/EX2 declared.
- [x] **Lot 1 — Custody tool + make targets (method §2, §0.2)**
  - [x] `deploy/ci/email-code-hmac/custody.mjs`: CSPRNG `randomBytes(32)` → 64-hex; private-descriptor atomic `.env` write (O_EXCL 0600 temp, fsync, rename, dir fsync; mode 0600 + unrelated lines preserved byte-for-byte); slot preconditions; cross-tier fingerprint refusal; keyRef `email-code-hmac:v1:<tier>:<fp16>`; keyed fingerprint over fixed label; test vector over synthetic input; buffer zeroed in `finally`; subcommands generate / rotate-begin / rotate-promote / rotate-retire / fingerprint / verify-vector; `--dry-run` (no write, no deposit); `deposit` via `gh secret set`/`gh variable set` reading stdin, value never in argv/env/print.
  - [x] Makefile targets: `email-code-hmac-generate|rotate-begin|rotate-promote|rotate-retire|fingerprint|verify-vector` (ENV=preprod|prod|test-* last; test env file `.env.$(ENV)`, git-ignored via `.env.*`), wired to `node deploy/ci/email-code-hmac/custody.mjs` inside the pinned node image (Docker-first), plus `test-email-code-hmac-selftest ENV=test-email-code-hmac`.
  - [x] Selftest K2: scratch env file generation (64-hex, right slot, mode 0600, unrelated lines preserved, refuses overwrite, refuses tracked/wrong-mode file), dry-run writes nothing, and captured stdout/stderr never contain the value (no-print assertion, compared privately).
- [x] **Lot 2 — Workflow + materialize logic (method §3.2)**
  - [x] `deploy/ci/email-code-hmac/materialize.mjs`: pure `validateRing`, `buildManifest` (data keys exactly §1.2, no empty strings), `keyedFingerprint`, `testVector`, `summaryLine` (names + refs + fingerprints only).
  - [x] `.github/workflows/email-code-hmac-secret.yml`: `workflow_dispatch` with `tier` choice input; `permissions: contents: read`; per-tier concurrency `cancel-in-progress: false`; gate job `selftest` (`make test-email-code-hmac-selftest ENV=test-email-code-hmac`); `materialize-preprod` (environment `sentropic-idp-run`) and `materialize-prod` (environment `sentropic-idp-prod`), `if` main + tier match; kubeconfig from `secrets.KUBE_CONFIG_DATA_EMAIL_CODE_HMAC` bound only via step `env:`, base64-decoded by a Node step into a runner-private 0600 exclusive-create file, removed by `always()` cleanup; preflight by name only (`get secret email-code-hmac -o name`, `can-i patch` on that Secret name and Deployment `api`; fixed refusal codes `email_code_hmac_shell_missing` / `email_code_hmac_writer_forbidden` / `email_code_hmac_credential_invalid` / `email_code_hmac_ref_mismatch`, no `create` attempted); `kubectl apply --server-side --field-manager=email-code-hmac-secret` onto the existing shell; assert `secret/email-code-hmac serverside-applied`; one JSON log line + `$GITHUB_STEP_SUMMARY` with Secret name, namespace, status, refs, keyed fingerprints only; `rollout restart deployment/api` + bounded `rollout status`; no `list` of Secrets, no value printing, no `${{` in run commands.
  - [x] Selftest K3 (in the same selftest target): stub `kubectl` on PATH executing the workflow's materialize step source — invalid format / previous-without-active / ref-fp16 mismatch refused pre-apply; manifest keys exactly §1.2; logged fingerprint equals the §0.2 keyed fingerprint and differs from any bare-SHA256 prefix; failing apply never echoes the value; temp manifest removed; apply args exactly `--server-side --field-manager=email-code-hmac-secret`.
- [x] **Lot 3 — Documentation (method §7)**
  - [x] `docs/secrets.md`: four inventory rows (ACTIVE/PREVIOUS per tier naming, 90-day three-phase cycle pointer, source chain `.env` → GitHub environment → workflow-applied Secret `email-code-hmac`), "Email-code HMAC key (Q-K=A)" section (purpose, names table, fail-closed summary, non-goals: not a SealedSecret, no terminal-printed `openssl rand`, no JWT/literal fallback — stated next to the existing dev/test fallback paragraph), writer-credential names by pointer to the k8s governance entry.
  - [x] `docs/runbooks/email-code-hmac-cred-cycle.md`: reconciliation table both tiers, writer kubeconfig names + renewal before 2027-02-01, living registry schema (one row per (tier, ref): fingerprint, test vector, dates, run ids, retirement proof), procedures (bootstrap, three-phase rotation, emergency, §4.4 retirement query, §5.2 restore verification, §5.3 loss matrix + break-glass), §7.2 pointer to k8s `preprod-cred-governance.md#email-code-hmac-writer`, §1.3/§5.3 k8s-noted readers (`sentropic-admin` / kubernetes-admin, kube-system controllers, ci-deployer, preprod edit binding) recorded as residual read (C3).
  - [x] `deploy/k8s/README.md`: one pointer entry in the secret-bundle section marking `email-code-hmac` as workflow-owned (not operator-sealed, never added to the SealedSecret bundle).
- [x] **Lot 4 — Validate, commit, PR, one CI**
  - [x] `flock .tmp/packets/DOCKER-LOCK.md make test-email-code-hmac-selftest ENV=test-email-code-hmac` green locally.
  - [x] `make scope-check` before each commit; atomic `make commit` per lot (≤150 lines); push after each commit.
  - [x] READY PR (body = BRANCH.md text, test plan included); exactly one CI run on the final head; report to `.tmp/rv/qk-bootstrap.md`; do not merge.
