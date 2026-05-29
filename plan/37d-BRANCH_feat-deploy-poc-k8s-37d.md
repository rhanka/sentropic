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
- **BR37d-EX1** (status: `used` 2026-05-29): Makefile — REMOVED the dead legacy serverless deploy targets (`check-scw`, `deploy-api-container-init`, `deploy-api-container`, `wait-for-container`, `deploy-api`) now that the serverless container is decommissioned (no make target added — the deletions were one-shot operator CLI, recorded in the runbook). Rollback: restore the block from git history.
- **BR37d-EX2** (status: `used` 2026-05-29): PLAN.md status update (BR-37d → merged/decommission done). Rollback: revert hunk.
- **BR37d-EX3** (status: `used` 2026-05-29): `.github/workflows/ci.yml` — REMOVED the legacy deploy jobs `deploy-api` (serverless, was failing since the container was deleted), `deploy-ui-only` + `deploy-ui` (GitHub Pages, old top-ai-ideas UI). Kept `deploy-k8s` (needs only publish-{api,ui}-image) + build/publish. Rollback: revert the ci.yml hunk.
- **BR37d-FL1** (severity: `blocker`, status: `resolved` 2026-05-29): managed DB delete IRREVERSIBLE. Pre-check cleared (instance hosted only `top-ai-ideas-db`; only the probe `psql` connected → onyxia/mistral `.env` refs were unused templates). Fresh `pg_dump` archived to S3 + verified, then deleted with user approval. Instance gone; sentropic (k8s DB) unaffected.
- **BR37d-FL2** (severity: `attention`, status: `resolved` 2026-05-29): operator chose redirect UI → sentropic + delete API record. API record deleted. UI redirect tracked in BR37d-FL3.
- **BR37d-FL3** (severity: `attention`, status: `resolved` 2026-05-29): redirect `top-ai-ideas.sent-tech.ca` → `https://sentropic.sent-tech.ca` could not be created via API — the `CF_API_TOKEN` lacks Rulesets/Redirect perms (`dns_records:edit` only; auth error 10000). Operator chose option (b): created the Single Redirect rule via the CF dashboard (Playwright). Rule = wildcard `https://top-ai-ideas.sent-tech.ca/*` → `https://sentropic.sent-tech.ca/${1}`, 301, preserve query string. Verified live (root + deep path 301 to sentropic; sentropic still 200).

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
  - [x] Confirm the k8s deployment is the sole live consumer (sentropic no longer reads `top-ai-ideas-db`; k8s `DATABASE_URL`=in-cluster postgres — verified BR-37c).

- [x] **Lot 1 — Legacy DNS redirect/cleanup (BR37d-FL2)** _(operator decision: redirect UI → sentropic, delete API record)_ _(done 2026-05-29)_
  - [x] Inventory: `top-ai-ideas.sent-tech.ca` (CNAME→rhanka.github.io, proxied, old UI) + `top-ai-ideas-api.sent-tech.ca` (CNAME→serverless, grey).
  - [x] Deleted `top-ai-ideas-api.sent-tech.ca` CNAME (no longer resolves).
  - [x] Redirect `top-ai-ideas.sent-tech.ca` → `https://sentropic.sent-tech.ca` created via the CF dashboard (Playwright) — the CF token lacks Rulesets/Redirect perms (BR37d-FL3 resolved). Single Redirect rule: wildcard `https://top-ai-ideas.sent-tech.ca/*` → `https://sentropic.sent-tech.ca/${1}`, 301, preserve query string.
  - [x] Lot gate: `https://top-ai-ideas.sent-tech.ca/` → 301 to sentropic (root + deep path with query preserved); `sentropic.sent-tech.ca` unaffected (still 200).

- [x] **Lot 2 — Decommission serverless container `top-ai-ideas-api`** _(done 2026-05-29)_
  - [x] Deleted the custom-domain mapping `top-ai-ideas-api.sent-tech.ca` (`7fc883bb…`) + the container `923fde8d…` (ns `poc-containers`, was `error`). Remaining containers (`nc-chatbot-api`, `transpose-cv-api`) untouched.
  - [x] Removed the dead legacy CI/make serverless-deploy machinery (BR37d-EX3 ci.yml jobs `deploy-api`/`deploy-ui-only`/`deploy-ui`; BR37d-EX1 Makefile `deploy-api*`/`wait-for-container`/`check-scw`) — they were deploying to the now-deleted container/GitHub-Pages.
  - [x] Lot gate: `scw container container list` no longer shows `top-ai-ideas-api`; sentropic k8s unaffected (api pod 1/1).

- [x] **Lot 3 — Decommission managed DB `top-ai-ideas-db`** _(done 2026-05-29, user-approved "backup frais puis delete")_
  - [x] PRE-CHECK cleared: instance hosted only `top-ai-ideas-db` (no onyxia/mistral DB); active connections = only the probe `psql` (no live external consumer → the `DATABASE_URL_PROD` refs in onyxia/mistral-ocr `.env` were unused templates).
  - [x] Fresh `pg_dump` (30.8 MiB gz) archived out-of-band to `s3://sentropic-pgbackup/legacy/top-ai-ideas-db-final-20260529T005644Z.sql.gz` (verified) — independent of the migration dump.
  - [x] Backup-gated delete: `scw rdb instance delete 3d04ec6c-e961-45d0-9427-01887fea3c23`. Instance gone (`scw rdb instance list` empty).
  - [x] Lot gate: `sentropic.sent-tech.ca` still serves 200 (k8s in-cluster postgres independent).

- [x] **Lot N-1 — Docs consolidation** _(done 2026-05-29)_
  - [x] Recorded decommission evidence in `docs/uat/2026-05-28-decommission-top-ai-ideas-37d.md`; noted legacy stack removed in `deploy/k8s/README.md`. PLAN.md status updated (BR37d-EX2).

- [ ] **Lot N — Final validation**
  - [ ] Confirm no live consumer broke (sentropic E2E smoke still green); CI green on PR (flaky-accepted).
  - [ ] PR body = this plan; CI green → remove `BRANCH.md` symlink, merge; move `plan/37d-*` to `plan/done/`.

## Deferred
- [ ] Cost verification post-decommission (LB-S + k8s pool only; managed DB + serverless billing stopped).
