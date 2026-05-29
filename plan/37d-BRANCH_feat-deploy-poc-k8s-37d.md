# Feature: BR-37d decommission legacy top-ai-ideas (serverless container + managed DB + DNS)

## Objective
Decommission the pre-k8s "top-ai-ideas" stack now that Sentropic runs on poc-k8s (BR-37c merged, PR #186): delete the SCW Serverless Container `top-ai-ideas-api`, delete the managed PostgreSQL instance `top-ai-ideas-db` (data already migrated to k8s + 132 MB dump kept), and redirect/clean the legacy Cloudflare DNS records so traffic lands on `sentropic.sent-tech.ca`.

## Scope / Guardrails
- Operator-side cleanup only: SCW CLI (`scw container` / `scw rdb`), Cloudflare API (zone `sent-tech.ca`), append-only `Makefile` operator targets, and docs.
- No app code (`api/`, `ui/`, `packages/`), no k8s tenant manifest change, no DB schema/migration, no docker-compose change.
- Make-only workflow; `ENV=<env>` always last. Live ops use `KUBECONFIG=$HOME/.kube/poc.yaml` only for verification (the k8s side is already live).
- Destructive SCW deletions are IRREVERSIBLE → back up first + explicit user go before each delete.
- All new text in English. Discuss with user in French.
- Branch identity: BR-37d, branch `feat/deploy-poc-k8s-37d`, worktree `tmp/feat-deploy-poc-k8s-37d`; base = origin/main `967f9d4a` (BR-37c merge).
- Local ports if ever needed (no dev stack expected): API `9190`, UI `5390`, Maildev `1290`.
- `BRANCH.md` is a symlink to `plan/37d-BRANCH_feat-deploy-poc-k8s-37d.md`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md` (symlink only)
  - `plan/37d-BRANCH_feat-deploy-poc-k8s-37d.md`
  - `docs/uat/2026-05-28-decommission-top-ai-ideas-37d.md` (decommission evidence/runbook)
  - `deploy/k8s/README.md` (runbook note: legacy stack decommissioned)
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`, `ui/**`, `packages/**`, `e2e/**`, `rules/**`, `spec/**`, `docker-compose*.yml`, `deploy/k8s/*.yaml`
  - `plan/NN-BRANCH_*.md` except `plan/37d-BRANCH_feat-deploy-poc-k8s-37d.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (`BR37d-EX1`, append-only: `legacy-decommission-*` / `cf-dns-*` operator helpers; never modify existing targets)
  - `PLAN.md` (`BR37d-EX2`, roadmap status update only)

## Feedback Loop
- **BR37d-EX1** (status: `pending`): append-only Makefile operator targets for decommission/DNS. Rollback: remove appended targets.
- **BR37d-EX2** (status: `pending`): PLAN.md status update (BR-37d). Rollback: revert hunk.
- **BR37d-FL1** (severity: `blocker`, status: `open`): the managed DB delete is IRREVERSIBLE. CRITICAL pre-check — `DATABASE_URL_PROD` pointing at `top-ai-ideas-db` was also found in `onyxia/.env` and `mistral-ocr/.env`; must verify `top-ai-ideas-db` is NOT a live shared DB for another app before deletion (list databases on the instance + check active connections). Back up (fresh `scw rdb` snapshot or `pg_dump`) + explicit user go before `scw rdb instance delete`.
- **BR37d-FL2** (severity: `attention`, status: `open`): DNS handling for `top-ai-ideas.sent-tech.ca` (CNAME→rhanka.github.io, old UI) + `top-ai-ideas-api.sent-tech.ca` (CNAME→old serverless). Operator decision: redirect to `https://sentropic.sent-tech.ca` (Cloudflare redirect rule) vs delete the records. Shared-infra/user-facing → confirm before applying.

## AI Flaky tests
- This branch changes no app/AI code; CI runs only on docs + appended Makefile targets. AI shards remain flaky-accepted (documented in BR-37c); rerun on the same commit if they block.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: small, tightly-coupled operator cleanup; one validation cycle.

## UAT Management (in orchestration context)
- Mono-branch. "UAT" = live verification that, after decommission, `https://sentropic.sent-tech.ca` still serves (no dependency on the deleted resources) and the legacy hostnames redirect/resolve as decided.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & scope**
  - [x] Worktree `tmp/feat-deploy-poc-k8s-37d` from origin/main `967f9d4a`; branch verified.
  - [x] Plan + `BRANCH.md` symlink; scope boundaries + exceptions declared.
  - [ ] Confirm the k8s deployment is the sole live consumer (sentropic no longer reads `top-ai-ideas-db`; k8s `DATABASE_URL`=in-cluster postgres — verified BR-37c).

- [ ] **Lot 1 — Legacy DNS redirect/cleanup (BR37d-FL2)**
  - [ ] Inventory current CF records for `top-ai-ideas*.sent-tech.ca`.
  - [ ] Per operator decision: create a Cloudflare redirect (`top-ai-ideas[-api].sent-tech.ca` → `https://sentropic.sent-tech.ca`) OR delete the records. Add `make cf-dns-*` helper (BR37d-EX1).
  - [ ] Lot gate: legacy hostnames resolve to the chosen target (redirect 30x to sentropic, or NXDOMAIN if deleted); `sentropic.sent-tech.ca` unaffected.

- [ ] **Lot 2 — Decommission serverless container `top-ai-ideas-api`**
  - [ ] Confirm the container is unused (status `error`, no live traffic after DNS handled).
  - [ ] Delete the container custom-domain mapping `top-ai-ideas-api.sent-tech.ca`, then the container (ns `poc-containers`). Add `make legacy-decommission-container` (BR37d-EX1).
  - [ ] Lot gate: `scw container container list` no longer shows `top-ai-ideas-api`; sentropic k8s unaffected.

- [ ] **Lot 3 — Decommission managed DB `top-ai-ideas-db` (BR37d-FL1, IRREVERSIBLE)**
  - [ ] PRE-CHECK: `scw rdb database list` + active connections; confirm NOT shared with onyxia/mistral-ocr (the `DATABASE_URL_PROD` references). If shared → STOP, escalate.
  - [ ] Fresh backup before delete (snapshot or `pg_dump` archived out-of-band).
  - [ ] Explicit user go → `scw rdb instance delete 3d04ec6c-e961-45d0-9427-01887fea3c23`. Add `make legacy-decommission-db` (BR37d-EX1, guarded).
  - [ ] Lot gate: instance gone; `sentropic.sent-tech.ca` still serves (k8s DB independent).

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Record decommission evidence in `docs/uat/2026-05-28-decommission-top-ai-ideas-37d.md`; note legacy stack removed in `deploy/k8s/README.md`. PLAN.md status (BR37d-EX2).

- [ ] **Lot N — Final validation**
  - [ ] Confirm no live consumer broke (sentropic E2E smoke still green); CI green on PR (flaky-accepted).
  - [ ] PR body = this plan; CI green → remove `BRANCH.md` symlink, merge; move `plan/37d-*` to `plan/done/`.

## Deferred
- [ ] Cost verification post-decommission (LB-S + k8s pool only; managed DB + serverless billing stopped).
