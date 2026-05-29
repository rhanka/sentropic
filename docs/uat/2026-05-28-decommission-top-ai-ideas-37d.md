# BR-37d — Decommission legacy `top-ai-ideas` stack (evidence + runbook)

Branch: `feat/deploy-poc-k8s-37d` (continuation of BR-37c, PR #186 merged `967f9d4a`).
Scope: operator-side teardown of the pre-k8s stack now that Sentropic runs on `poc-k8s`.
Operator: Fabien Antoine. All destructive ops were backup-gated + user-approved.

## Lot 1 — Legacy Cloudflare DNS (zone `sent-tech.ca`, id `0ed3b4929f2881018ee2a67816075670`) — DONE 2026-05-29

- **API host** `top-ai-ideas-api.sent-tech.ca` (CNAME → old serverless): record **deleted** via CF API (token `dns_records:edit`). No longer resolves.
- **UI host** `top-ai-ideas.sent-tech.ca` (CNAME → `rhanka.github.io`, old GitHub-Pages UI): kept as a DNS record and fronted by a **Single Redirect rule** → `https://sentropic.sent-tech.ca` (BR37d-FL2 operator decision "redirect UI → sentropic").
  - The redirect could not be created by API: the `CF_API_TOKEN` lacks `Rulesets`/Redirect permission (auth error 10000), only `dns_records:edit` (BR37d-FL3). Per operator choice, created via the **Cloudflare dashboard (Playwright)** instead.
  - Rule (zone `sent-tech.ca`, phase `http_request_dynamic_redirect`): name `BR-37d redirect legacy top-ai-ideas to sentropic`; wildcard match `https://top-ai-ideas.sent-tech.ca/*` → dynamic target `https://sentropic.sent-tech.ca/${1}`; status **301**; preserve query string **on**.
  - **Verified live**:
    - `https://top-ai-ideas.sent-tech.ca/` → `301` → `https://sentropic.sent-tech.ca/`
    - `https://top-ai-ideas.sent-tech.ca/projects/abc?x=1` → `301` → `https://sentropic.sent-tech.ca/projects/abc?x=1` (path + query preserved)
    - `https://sentropic.sent-tech.ca/` → `200` (unaffected)

## Lot 2 — SCW Serverless Container `top-ai-ideas-api` (ns `poc-containers`) — DONE 2026-05-29

- Deleted the custom-domain mapping `top-ai-ideas-api.sent-tech.ca` (`7fc883bb…`) and the container `923fde8d…` (state was `error`). Remaining containers in the namespace (`nc-chatbot-api`, `transpose-cv-api`) untouched — verified `scw container container list` no longer lists `top-ai-ideas-api`.
- Removed the now-dead legacy deploy machinery (it targeted the deleted container / old GitHub-Pages UI):
  - **BR37d-EX3** `.github/workflows/ci.yml`: removed jobs `deploy-api` (serverless), `deploy-ui-only` + `deploy-ui` (GitHub Pages). Kept `deploy-k8s` (needs `publish-{api,ui}-image`) + build/publish.
  - **BR37d-EX1** `Makefile`: removed `check-scw`, `deploy-api-container-init`, `deploy-api-container`, `wait-for-container`, `deploy-api`. `make -n k8s-deploy` still parses.
- Lot gate: sentropic k8s unaffected (api pod `1/1`).

## Lot 3 — Managed PostgreSQL `top-ai-ideas-db` (`3d04ec6c-e961-45d0-9427-01887fea3c23`) — DONE 2026-05-29

- **PRE-CHECK** (BR37d-FL1, irreversible): the instance hosted only `top-ai-ideas-db`; active connections were the verification `psql` probe only. The `DATABASE_URL_PROD` references in the `onyxia` / `mistral-ocr` `.env` files were unused templates, not live consumers.
- **Backup-gated delete**: fresh `pg_dump --no-owner --no-privileges | gzip` = **30.8 MiB** archived out-of-band to `s3://sentropic-pgbackup/legacy/top-ai-ideas-db-final-20260529T005644Z.sql.gz` and verified present (GATE) before any delete — independent of the BR-37c migration dump. Then `scw rdb instance delete`. `scw rdb instance list` now empty.
- Lot gate: `https://sentropic.sent-tech.ca/` still `200` — the k8s in-cluster postgres is independent of the deleted managed instance (data was migrated in BR-37c).

## Cost impact

- Managed PostgreSQL instance + Serverless Container billing **stopped**. Remaining steady-state SCW spend for Sentropic: the Kapsule node pool + the shared `lb-s` LoadBalancer (cluster-wide platform, shared across tenants).

## Final validation

- `https://sentropic.sent-tech.ca/` served `200` throughout the teardown (no dependency on any deleted resource).
- Legacy `top-ai-ideas.sent-tech.ca` now `301`-redirects to sentropic; `top-ai-ideas-api.sent-tech.ca` no longer resolves.
- CI: branch diff is operator-side only (`.github/workflows/ci.yml` legacy-job removal, `Makefile` legacy-target removal, `plan/`, `docs/`) — no app/AI code. AI shards remain flaky-accepted (documented in BR-37b/c); rerun on the same commit if they block.
