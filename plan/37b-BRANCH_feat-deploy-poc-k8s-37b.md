# Feature: BR-37b Email egress fix (Scaleway TEM HTTP API) + Sealed Secrets

## Objective
**Delivered scope of this branch (split from the original 4-item plan):** fix outbound email from the `poc-k8s` Kapsule pod (BR37-FL16, SMTP egress blocked at platform level) by migrating the app from Nodemailer SMTP to the Scaleway TEM HTTP API (zero dual paths, dev Maildev preserved via a local mock), and introduce Bitnami Sealed Secrets so `sentropic-api`/`sentropic-postgres` become git-as-source-of-truth (controller live, secrets resealed with `SCW_TEM_SECRET_KEY`, no `MAIL_*`).

**Split decision (2026-05-25):** the original BR-37b plan bundled four items. Postgres backup, public Ingress + cert-manager (Cloudflare DNS-01), the end-to-end deploy validation, and the post-merge live email smoke are **moved to a continuation branch BR-37c** (`plan/37c-BRANCH_feat-deploy-poc-k8s-37c.md`). This keeps the merged PR honest: it contains only the email migration + sealed secrets, both CI-green and operator-applied on the live cluster. The `poc-k8s` cluster name is operational scaffolding only; this stack is treated as production (no `poc` segment in user-facing/persistent resource names).

## Scope / Guardrails
- Scope limited to tenant manifests under `deploy/scw/**`, append-only `Makefile` targets for new operator helpers, CI `deploy-k8s` job trigger surface, UAT evidence docs, and `plan/37b-BRANCH_*.md` itself.
- No app code changes (`api/`, `ui/`, `packages/`).
- No database schema migration.
- No docker-compose change.
- No dev/CI migration to Kubernetes; root dev remains docker-compose.
- BR-37b is a follow-up of BR-37 (merged via PR #160). BR-14d still owns final production naming/transition ops.
- Make-only workflow for this repo; no direct Docker or kubectl commands outside make targets.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-deploy-poc-k8s-37b`.
- Automated local gates, if needed, run on `ENV=test-feat-deploy-poc-k8s-37b`, never on root `dev`.
- UAT qualification runs against the live `poc-k8s` tenant after image publication and records cluster evidence in `docs/uat/2026-05-24-deploy-poc-k8s-37b.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch identity: BR-37b, branch `feat/deploy-poc-k8s-37b`, worktree `tmp/feat-deploy-poc-k8s-37b`; base commit `b48065d1` (origin/main at branch creation).
- Local slot 1 ports, only for local gates if needed: API `9186`, UI `5386`, Maildev `1286`. Slot 0 (`9185`/`5385`/`1285`) reserved for legacy `tmp/feat-deploy-poc-k8s` worktree.
- Live k8s UAT uses `KUBECONFIG=$HOME/.kube/poc.yaml` and temporary port-forwards for api/ui smoke checks.
- `BRANCH.md` must remain a symlink to `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` in `tmp/feat-deploy-poc-k8s-37b`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md` (symlink only)
  - `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md`
  - `deploy/scw/**` (tenant manifests, including new files for sealed-secrets resources, postgres-backup CronJob, ingress, cert-manager ClusterIssuer)
  - `docs/uat/2026-05-24-deploy-poc-k8s-37b.md`
  - `tools/scw-tem-mock/**` (new, BR37b-EX6: minimal local HTTP→SMTP proxy compatible with the SCW TEM API surface, dev-only)
- **Forbidden Paths (must not change in this branch)**:
  - `ui/**`
  - `packages/**`
  - `e2e/**`
  - `rules/**`
  - `spec/**`
  - `.cursor/rules/**`
  - `TRANSITION.md`
  - `api/drizzle/*.sql`
  - `plan/NN-BRANCH_*.md` except `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md`
  - any `api/**` outside the exceptional email-migration set listed under `BR37b-EX4`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (`BR37b-EX1`, append-only targets for sealed-secrets, postgres backup, smtp diagnostics, dns/ingress smoke; never modify existing BR-37 `scw-*` block behavior)
  - `.github/workflows/ci.yml` (`BR37b-EX2`, if a deploy-k8s trigger touch is needed to validate the end-to-end chain on a non-deploy-touching merge — strict scope: trigger conditions only, no logic change)
  - `PLAN.md` (`BR37b-EX3`, roadmap registration of BR-37b only)
  - `api/src/services/magic-link.ts`, `api/src/services/email-verification.ts`, `api/src/config/env.ts`, related unit tests (`BR37b-EX4`, migrate from Nodemailer SMTP to Scaleway TEM HTTP API; zero dual paths; drop nodemailer dependency)
  - `docker-compose*.yml` (`BR37b-EX5`, add `scw-tem-mock` service for dev local; keep maildev for SMTP UI; wire api → scw-tem-mock by environment override)
- **Exception process**:
  - Declare exception ID `BR37b-EXn` in `## Feedback Loop` before touching any conditional path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- **BR37b-EX1** (status: `accepted`, used for `scw-sealed-secrets-install`/`scw-seal-secret`/`scw-sealed-secrets-backup-key`; pgbackup/smtp-diag/dns-smoke targets move to BR-37c): Conditional `Makefile` change for append-only operator targets: `scw-sealed-secrets-install`, `scw-seal-secret`, `scw-pgbackup-now`, `scw-pgbackup-restore`, `scw-smtp-diag`, `scw-dns-smoke`. Reason: encode new operator paths as Make-only entrypoints consistent with BR-37 `scw-*` block. Impact: append-only targets; no existing target behavior changed. Rollback: remove appended targets.
- **BR37b-EX2** (status: `not used` in BR-37b; deploy-k8s trigger work moves to BR-37c): Conditional `.github/workflows/ci.yml` change, scope strictly limited to extending the `deploy-k8s` job trigger filter so that ingress/sealed-secret/backup manifest changes do trigger a fresh apply on merge, plus optional ingress/cert smoke step. No change to publish or build jobs. Rollback: revert ci.yml diff.
- **BR37b-EX3** (status: `done`, PLAN.md addendum 2026-05-25 registers BR-37/37b/37c): Add BR-37b row in `PLAN.md` branch catalog (`§3`) and dependency graph (`§4`). Reason: roadmap hygiene. Impact: docs-only. Rollback: revert PLAN.md hunks.
- **BR37b-EX4** (status: `accepted`, applied + CI-green): Conditional change in `api/src/services/magic-link.ts`, `api/src/services/email-verification.ts`, `api/src/config/env.ts`, and their unit tests. Reason: Lot 0 diagnostic confirmed SMTP egress is blocked at the Kapsule platform level (TEM, Gmail, IPv4 direct all time out; HTTPS to `api.scaleway.com` succeeds), and no NetworkPolicy egress in our namespace can change that — the platform drops the SYN. The only technically clean fix is to migrate outbound mail from Nodemailer SMTP to Scaleway TEM HTTP API (POST `https://api.scaleway.com/transactional-email/v1alpha1/regions/{region}/emails`, header `X-Auth-Token: <SCW_TEM_SECRET_KEY>`). Impact: introduce `api/src/services/scw-tem-client.ts`, swap the two existing nodemailer call sites, drop the nodemailer dependency from `api/package.json`, replace `MAIL_*` env vars with `SCW_TEM_*` in `env.ts`. Zero dual paths: nodemailer code and dep removed. Rollback: revert the four files + restore the nodemailer dep.

- **BR37b-IAM1** (status: `done`, recorded 2026-05-24): Existing SCW IAM application `sent-tech-mail` (id `b898a07e-29cf-46b2-ba8f-d20916157c78`) already owns the API key `SCWR1Z91RNSWVT9GC8PH` used by the legacy SMTP path. The matching policy `sent-tech-mail` (id `1a7a2ec3-f5cd-444e-9db4-f0d524da936d`) was scoped to project `PoCs` (`09ac728a-e3b9-4a5b-9749-664b0f147c70` — same as `SCW_DEFAULT_PROJECT_ID`) with only `TransactionalEmailEmailSmtpCreate`. On 2026-05-24 the policy was extended via the Scaleway console (Playwright session) to also include `TransactionalEmailEmailApiCreate`. Validation: live `POST https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails` with `X-Auth-Token: <SCW_SECRET_KEY>` returned HTTP 200 with `message_id` (test recipient: `fabien.antoine@gmail.com`, status `ready to send`, mail received). Decision: **reuse the existing IAM key for HTTP API too**; no new IAM Application or secret key created. After the code migration completes and the SMTP path is removed, the `TransactionalEmailEmailSmtpCreate` permission can be removed from the rule (separate IAM operation, not blocking).
- **BR37b-EX5** (status: `pending`): Conditional change in `docker-compose*.yml` to add a new dev-only service `scw-tem-mock` that exposes the TEM API surface on `http://scw-tem-mock:7700` and forwards each accepted payload to maildev SMTP. Wires the api service env var `SCW_TEM_API_BASE_URL=http://scw-tem-mock:7700` in dev (production sets it to `https://api.scaleway.com` via the SealedSecret). Reason: dev local must keep visibility into outgoing emails via the existing maildev UI without dual code paths inside the api. Impact: one new container in docker-compose + an env override on the api service block; no change to existing compose services. Rollback: revert the docker-compose hunks.
- **BR37b-EX6** (status: `pending`): New `tools/scw-tem-mock/` directory containing `Dockerfile`, `index.js` (~50 lines: Express + nodemailer-to-maildev), and `package.json` (only `express` + `nodemailer`). Reason: implement the dev-only TEM API mock declared by `BR37b-EX5`. Impact: new self-contained tooling directory under `tools/`, never imported by api/ui code. Rollback: delete the directory + revert the docker-compose hunk.
- **BR37b-Q1** (severity: `attention`, status: `open`): `api/package-lock.json` still references `nodemailer` (6 refs) but is NOT in this branch's allowed paths (launch packet allows only root `package-lock.json`). Evidence: the API Dockerfile copies and installs the ROOT lockfile (`COPY package.json package-lock.json* ./` + `npm ci --workspaces --include-workspace-root`), which is now nodemailer-free; `api/package-lock.json` is consumed only by `make lock-api` (`exec api`) and the `API_VERSION` content hash. Regenerating it requires either the api dev container running (`make lock-api`) or editing a non-allowed path. Recommendation: operator runs `make lock-api ENV=test-feat-deploy-poc-k8s-37b` (or grants `api/package-lock.json` to allowed paths) to fully drop the stale entry. Not blocking the build/runtime since the root lockfile governs `npm ci`.
- **BR37b-FL1** (severity: `attention`, status: `open`): Carries forward BR37-FL16. Live outbound email from the k8s POC pod is blocked at SMTP egress. As of 2026-05-22, `scw-email-smoke` returned HTTP 500; pod-side netcheck showed `smtp.tem.scaleway.com:465` and `:587` time out, IPv4 `51.159.84.239:465` times out, while `api.scaleway.com:443` reachable. Working hypothesis: Scaleway Kapsule egress posture blocks outbound SMTP, or Scaleway TEM IP ranges are unreachable from the POC node pool subnet. Investigate before fixing.
- **BR37b-FL2** (severity: `attention`, status: `open`): Sealed Secrets is the standard k8s pattern selected by user (no Vault, no External Secrets Operator with remote backend). Controller deployed as a Helm release or raw manifests in a dedicated namespace; sealing key sealed-into the cluster. Disaster recovery: backup the controller's sealing key (master) out-of-band; document procedure.
- **BR37b-FL3** (severity: `attention`, status: `open`): Postgres backup uses a k8s native `CronJob` with `pg_dump | aws s3 cp` to SCW Object Storage (S3-compatible). No CNPG operator. Bucket name `sentropic-pgbackup` is **not hardcoded** — manifests reference env var `PG_BACKUP_BUCKET`. Bucket is operator-provisioned in the same SCW project as the existing app object storage, via SCW CLI: `scw object bucket create name=sentropic-pgbackup region=$DOC_STORAGE_REGION_PROD project-id=$SCW_DEFAULT_PROJECT_ID`. IAM credentials are **mutualised** with `DOC_STORAGE_ACCESS_KEY_PROD` / `DOC_STORAGE_SECRET_KEY_PROD` already present in root `.env`: segmentation enforced at the bucket boundary, not at the credential boundary (per user direction "pas à l'excès"). New root `.env` entries: `PG_BACKUP_BUCKET=sentropic-pgbackup`, optional `PG_BACKUP_REGION` / `PG_BACKUP_ENDPOINT` (default to the `DOC_STORAGE_*_PROD` siblings if unset). No new secret value is committed; the SealedSecret references the same credentials as the app.
- **BR37b-FL4** (severity: `attention`, status: `open`): Public DNS + Ingress + cert-manager. Confirmed POC public hostname: `sentropic.sent-tech.ca` (under the existing `sent-tech.ca` zone hosted on Cloudflare). cert-manager uses the **Cloudflare DNS-01 ACME challenge** (not HTTP-01), which allows wildcard certs for `*.sent-tech.ca` and works without exposing the Ingress on port 80 during the challenge. Cloudflare API token (scope: `Zone / DNS / Edit` on `sent-tech.ca`) is provisioned operator-side and stored in root `.env` as `CLOUDFLARE_API_TOKEN`, then sealed into the cluster via Sealed Secrets. ClusterIssuer staging is used first to validate the loop, then production after one successful issuance.

## AI Flaky tests
- This branch does not change AI runtime behavior (Lot 1 only swaps the outbound email transport; chat/SSE/tool-calling is untouched).
- Carries forward the BR37 acceptance for `tests/03-chat.spec.ts` if rerun signature reappears on the branch PR; document here and request user sign-off only if observed.

- **E2E flaky observed on PR #176 (commit `1ab59715`, run `26382665015`)**:
  - Suite/job: `test-e2e (group-e, 05 07)`.
  - Failing test: `e2e/tests/05-usecase-detail.spec.ts:185 › Détail des cas d'usage › devrait mettre à jour un champ liste via chat (SSE)`.
  - Signature: `Test timeout of 30000ms exceeded` while `expect(constraintsSection).toContainText("E2E_CONSTRAINT_<ts>")` — the live LLM did not write the token into the constraints field via chat tool-calling within the window (observed value `"Contraintes     "`). Failed initial + retry #1 + retry #2.
  - Classification: provider/model nondeterminism on a live-LLM chat-SSE tool-call path. Unrelated to the Lot 1 email migration (no chat/SSE/tool code touched).
  - Non-systematic confirmation: re-ran the `test-e2e (group-e, 05 07)` job on the same commit `1ab59715` → **SUCCESS**. At least one success on the same commit + same command → meets the `flaky accepted` criterion.
  - Allowlist gap: `e2e/tests/05-usecase-detail.spec.ts` is NOT currently in the E2E AI flaky allowlist of `rules/testing.md` (which lists `00-ai-generation`, `03-chat`, `03-chat-chrome-extension`, `07_comment_assistant`). The SSE-chat-field-update test in `05` is equally live-LLM-dependent. Proposal (deferred, not in this branch's scope): add `e2e/tests/05-usecase-detail.spec.ts` (SSE chat update case) to the allowlist via a dedicated rules change.
  - Exact rerun evidence command (operator): `gh run rerun 26382665015` (job `test-e2e (group-e, 05 07)`) → green.
  - User sign-off: `pending` — see `## User sign-off`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: four small infrastructure lots tightly coupled to the same tenant manifests and operator runbook. Multi-branch would force redundant `scw-deploy` cycles and risk drift between sub-branches without reducing risk.

## UAT Management (in orchestration context)
- Mono-branch. UAT happens against the live `poc-k8s` cluster after PR image republish (or after each lot for k8s-only changes that do not require a new image).
- Root dev/UAT remains reserved for user dev on `ENV=dev`.
- Docker-compose dev/CI remains unchanged.
- Merge gate:
  - [ ] PR CI is green.
  - [ ] Live Kubernetes UAT passes for each impacted lot (SMTP egress, sealed secrets round-trip, pg backup round-trip, public ingress TLS reachability), or explicit user waiver recorded per lot.
  - [ ] Rollback path is documented per new resource (sealed-secrets, pgbackup, ingress, cert-manager).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & investigation**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/security.md`, `rules/testing.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [ ] Confirm branch `feat/deploy-poc-k8s-37b`, worktree `tmp/feat-deploy-poc-k8s-37b`, base commit `b48065d1`.
  - [ ] Confirm `BRANCH.md` is a symlink to `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` in worktree root.
  - [ ] Confirm operator side prerequisites unchanged since BR-37: namespace `sentropic`, ResourceQuota, LimitRange, baseline NetworkPolicies in `~/src/poc-k8s/tenants/sentropic`.
  - [ ] Snapshot live state: `make scw-status KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b`. Record evidence in `docs/uat/2026-05-24-deploy-poc-k8s-37b.md`.
  - [ ] Capture current SMTP egress signature: `make scw-api-netcheck SCW_NETCHECK_HOST=smtp.tem.scaleway.com SCW_NETCHECK_PORT=465 KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b`. Repeat with port 587 and with `api.scaleway.com:443` as control.
  - [ ] Confirm scope and guardrails. Declare `BR37b-EX1`, `BR37b-EX2`, `BR37b-EX3` only when first impacted file is touched.

- [ ] **Lot 1 — Email migration from SMTP to Scaleway TEM HTTP API (BR37b-FL1, BR37b-EX4/EX5/EX6)**

  - [ ] **Lot 1.0 — Confirm Lot 0 diagnostic is recorded**
    - [ ] Append the Lot 0 netcheck matrix (TEM 465/587 ETIMEDOUT, IPv4 direct 8000ms timeout, Gmail 465 ETIMEDOUT, control `api.scaleway.com:443` OK 32ms, namespace NetworkPolicies all `ingress` only) into `docs/uat/2026-05-24-deploy-poc-k8s-37b.md`. Conclusion line: "Platform-level SMTP egress block; only HTTPS to `api.scaleway.com` reachable; mandatory migration to TEM HTTP API."
    - [ ] Add `make scw-smtp-diag` target (append-only Makefile) that runs the same three netchecks in one shot and prints a verdict line. (BR37b-EX1)

  - [x] **Lot 1.1 — Reuse existing SCW IAM key (operator-side, done 2026-05-24)**
    - [x] Identified existing IAM Application `sent-tech-mail` (id `b898a07e-29cf-46b2-ba8f-d20916157c78`) already attached to the SMTP path via API key `SCWR1Z91RNSWVT9GC8PH`. Policy `sent-tech-mail` (id `1a7a2ec3-f5cd-444e-9db4-f0d524da936d`) scoped to project `PoCs` (`09ac728a-e3b9-4a5b-9749-664b0f147c70` = `SCW_DEFAULT_PROJECT_ID`).
    - [x] Extended Rule #1 of that policy via Scaleway console (Playwright session) to add permission set `TransactionalEmailEmailApiCreate` alongside existing `TransactionalEmailEmailSmtpCreate`. Confirmed by live `POST /transactional-email/v1alpha1/regions/fr-par/emails` returning HTTP 200 + `message_id` and a real email delivery to the operator inbox.
    - [x] Conclusion: **no new IAM Application or secret key created**. The HTTP API client must reuse the existing secret value currently stored in root `.env` as `MAIL_PASSWORD` (will be remapped to `SCW_TEM_SECRET_KEY` in Lot 1.2; same value).
    - [x] Recorded full IAM trail in `docs/uat/2026-05-24-deploy-poc-k8s-37b.md` (without leaking the secret): Application id, Policy id, both permission sets, project id, region (`fr-par`), validated sender domain (`sent-tech.ca`), `message_id` of the live smoke send.

  - [x] **Lot 1.2 — Add `SCW_TEM_*` env vars + Zod schema (BR37b-EX4)**
    - [x] Edit `api/src/config/env.ts`:
      - Add `SCW_TEM_API_BASE_URL` (default `https://api.scaleway.com`, dev override `http://scw-tem-mock:7700`).
      - Add `SCW_TEM_REGION` (default `fr-par`).
      - Add `SCW_TEM_PROJECT_ID` (required, falls back to `SCW_DEFAULT_PROJECT_ID` if absent).
      - Add `SCW_TEM_SECRET_KEY` (required; in prod = existing key under `MAIL_PASSWORD`/the secret key of IAM Application `sent-tech-mail`; in dev = any non-empty string accepted by the mock).
      - Add `SCW_TEM_FROM_EMAIL` (default `no-reply@sent-tech.ca`) and `SCW_TEM_FROM_NAME` (default `Sentropic`).
      - **Remove** `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM` (zero dual paths).
    - [ ] Edit root `.env` accordingly:
      - Replace the legacy `MAIL_*` block (lines 64-67 area) with `export SCW_TEM_SECRET_KEY=<same value as the old MAIL_PASSWORD>`, `export SCW_TEM_PROJECT_ID="${SCW_DEFAULT_PROJECT_ID}"`, `export SCW_TEM_REGION=fr-par`, `export SCW_TEM_FROM_EMAIL=no-reply@sent-tech.ca`. No new secret to procure; same IAM secret key, scope now covers API send via the `BR37b-IAM1` policy extension.

  - [x] **Lot 1.3 — New `api/src/services/scw-tem-client.ts` (BR37b-EX4)**
    - [x] Single function `sendTransactionalEmail({ to, subject, html, text, fromEmail?, fromName? }): Promise<{ messageId: string }>`.
    - [x] Implementation: `fetch(${env.SCW_TEM_API_BASE_URL}/transactional-email/v1alpha1/regions/${env.SCW_TEM_REGION}/emails, { method: 'POST', headers: { 'X-Auth-Token': env.SCW_TEM_SECRET_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id, from: { email, name }, to: [{ email }], subject, html, text }) })`.
    - [x] On non-2xx: throw with structured error (status, response body excerpt).
    - [x] Add a unit test stub that mocks `fetch` and asserts payload shape (`api/tests/unit/services/scw-tem-client.test.ts`, 3 tests passing).

  - [x] **Lot 1.4 — Migrate call sites (BR37b-EX4)**
    - [x] `api/src/services/magic-link.ts`: replace `nodemailer.createTransport` + `transporter.sendMail` with `sendTransactionalEmail({...})`. Delete the `mailTransporter` singleton, `getMailTransporter` helper, and the nodemailer import.
    - [x] `api/src/services/email-verification.ts`: same migration. Delete the `mailTransporter` singleton, `getMailTransporter` helper, and the nodemailer import.
    - [x] Confirm no other `nodemailer` import remains in `api/**` (grep `api/src` → zero).

  - [x] **Lot 1.5 — Remove nodemailer dependency (BR37b-EX4)**
    - [x] Removed `nodemailer` + `@types/nodemailer` from `api/package.json` (deps + the two `--external:nodemailer` esbuild flags in the build script); regenerated root `package-lock.json` via `make lock-root` (zero nodemailer refs). `api/package-lock.json` left untouched (out of allowed scope) — see BR37b-Q1; root lockfile is the one the API Dockerfile consumes via `npm ci --workspaces`.
    - [x] Confirmed `make typecheck-api` + `make lint-api` pass with the dep removed.

  - [x] **Lot 1.6 — Update api tests (BR37b-EX4)**
    - [x] Identified tests under `api/tests/**`: grep for `nodemailer` and `MAIL_` returns ZERO test files. No test mocks the mail transport or `MAIL_*` env vars (auth tests exercise DB-level token generation + HTTP endpoints, never the email transport). So no nodemailer/MAIL_ mock to migrate.
    - [x] Replaced (n/a — no existing mocks); added a new `fetch`-mock unit test asserting the TEM payload shape (covered under Lot 1.3).
    - [x] Run scoped: `make test-api-unit SCOPE=tests/unit/services/scw-tem-client.test.ts ENV=test-feat-deploy-poc-k8s-37b` (3 pass) and `make test-api-unit SCOPE=tests/unit/auth/magic-link.test.ts ENV=...` (7 pass).

  - [x] **Lot 1.7 — Implement dev mock `tools/scw-tem-mock/` (BR37b-EX6)**
    - [x] Created `tools/scw-tem-mock/index.js`: Express server on port 7700, route `POST /transactional-email/v1alpha1/regions/:region/emails`, forwards to maildev via `nodemailer.createTransport({ host: 'maildev', port: 1025 })`, returns `{ emails: [{ id, message_id, status: 'sending' }] }`; accepts any X-Auth-Token; `/health` route added.
    - [x] Created `tools/scw-tem-mock/package.json`: deps `express`, `nodemailer`; start script `node index.js`.
    - [x] Created `tools/scw-tem-mock/Dockerfile`: `FROM node:24-alpine`, `npm install --omit=dev`, `CMD ["node","index.js"]`.

  - [x] **Lot 1.8 — Wire docker-compose (BR37b-EX5)**
    - [x] Edited `docker-compose.yml`: added service `scw-tem-mock` (`build: ./tools/scw-tem-mock`, env `MAILDEV_HOST/MAILDEV_SMTP_PORT`, depends_on maildev, same default network as api+maildev); added `scw-tem-mock` to the api `depends_on`.
    - [x] Edited api service env block: replaced the dead `MAIL_*` block with `SCW_TEM_API_BASE_URL` (default `http://scw-tem-mock:7700`), `SCW_TEM_SECRET_KEY` (default `dev-mock-token`), `SCW_TEM_PROJECT_ID` (default `dev-mock-project`), `SCW_TEM_REGION` (`fr-par`), `SCW_TEM_FROM_EMAIL`, `SCW_TEM_FROM_NAME`.
    - [x] Maildev service unchanged. Live dev smoke: magic-link request → scw-tem-mock → maildev delivered the email (verified via maildev REST API).

  - [ ] **Lot 1.9 — Sealed Secret for prod `SCW_TEM_SECRET_KEY`**
    - [ ] Depends on Lot 2 sealed-secrets controller bootstrap. Track as cross-lot dependency: Lot 2 must reach controller-installed state before Lot 1.9.
    - [ ] Add `SCW_TEM_SECRET_KEY`, `SCW_TEM_PROJECT_ID`, `SCW_TEM_REGION`, `SCW_TEM_FROM_EMAIL` keys into the existing `sentropic-api` SealedSecret (`deploy/scw/05-sealed-sentropic-api.yaml`).
    - [ ] Update `deploy/scw/30-api.yaml` env block to load these from the Secret; remove the old `MAIL_*` env keys.

  - [ ] **Lot 1.10 — Deploy + live UAT** _(→ MOVED to BR-37c: gated on this PR merging + `publish-api-image` republishing `sentropic-api:main`; live `make scw-email-smoke` runs post-merge)_
    - [ ] `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b`. Confirm api pod restarts and reads new env.
    - [ ] `make scw-email-smoke SCW_EMAIL_SMOKE_TO=fabien.antoine@gmail.com KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b`. Verify HTTP 200 from api + email arrives in inbox (screenshot in UAT doc).
    - [ ] Dev local: `make dev API_PORT=9186 UI_PORT=5386 MAILDEV_UI_PORT=1286 ENV=test-feat-deploy-poc-k8s-37b`, trigger magic-link from UI, confirm email lands in Maildev UI via the mock.

  - [ ] **Lot 1 gate**:
    - [ ] `make typecheck-api` + `make lint-api` green with nodemailer dep removed.
    - [ ] `make test-api ENV=test-feat-deploy-poc-k8s-37b` green (no nodemailer-mocking tests remain).
    - [ ] `make scw-email-smoke ENV=test-feat-deploy-poc-k8s-37b` returns 200 + delivery confirmed.
    - [ ] Maildev UI dev local shows the magic-link email via scw-tem-mock proxy.
    - [ ] Mark `BR37b-FL1` as `fixed` with evidence.

- [ ] **Lot 2 — Sealed Secrets controller + sealing (BR37b-FL2)**
  - [x] Decide controller install method (manifest-only vs Helm). Decided: official manifest install from `bitnami-labs/sealed-secrets` release pinned to `v0.37.0`, retargeted to dedicated namespace `sealed-secrets`, no Helm dependency.
  - [x] Add `deploy/scw/01-sealed-secrets-controller.yaml` for: namespace, ServiceAccount, RBAC, Deployment, Service. Image tag pinned to `docker.io/bitnami/sealed-secrets-controller:0.37.0`. Upstream URL + version + namespace retarget recorded in header comment; zero `kube-system` references remain.
  - [x] Add `make scw-sealed-secrets-install` target (append-only) that applies the controller manifests and waits for controller readiness. (BR37b-EX1)
  - [ ] Generate `kubeseal` binding for existing `sentropic-api` and `sentropic-postgres` Secrets currently created by `make scw-bundle-secret`.
  - [ ] Replace the imperative `scw-bundle-secret` flow with sealed Secrets stored in `deploy/scw/`:
    - [ ] `deploy/scw/05-sealed-sentropic-api.yaml` (SealedSecret resource, encrypted, safe to commit).
    - [ ] `deploy/scw/06-sealed-sentropic-postgres.yaml`.
    - [x] Add `make scw-seal-secret` helper that seals a given plaintext Secret yaml (`SEAL_SRC`) into a target SealedSecret yaml (`SEAL_OUT`) via the pinned `bitnami/sealed-secrets-kubeseal:0.37.0` image; reads the controller cert from the live kube API via `$(KUBECONFIG)`; hardcodes no secret value. Also added `make scw-sealed-secrets-backup-key` (DR export of the controller sealing key to `SEAL_KEY_OUT`, with sensitivity warnings). (BR37b-EX1)
  - [x] Document the disaster-recovery procedure for the controller's sealing key in `deploy/scw/README.md` (operator-side out-of-band backup via `make scw-sealed-secrets-backup-key SEAL_KEY_OUT=...`, file path on operator host, restore steps). Added a full "Sealed Secrets" runbook section: install, seal workflow (plaintext Secret -> `make scw-seal-secret` -> committable `05-*`/`06-*`), DR backup/restore, and a note that `05-*`/`06-*` SealedSecret files are produced by the operator (conductor), not by this manifest/tooling change.
  - [ ] Deprecate or document the legacy `scw-bundle-secret` path (kept for emergency unseal, but no longer the primary mechanism for `sentropic-api` and `sentropic-postgres`).
  - [ ] Lot gate:
    - [ ] `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b` applies controller + sealed secrets cleanly.
    - [ ] UAT k8s: kubectl confirms `Secret/sentropic-api` and `Secret/sentropic-postgres` are reconciled from the SealedSecret resources by the controller.
    - [ ] Rolling api/ui pods come up with the reconciled secrets (no env-var regression).

- [ ] **Lot 3 — Postgres backup CronJob to SCW Object Storage (BR37b-FL3)** _(→ MOVED to BR-37c)_
  - [ ] Verify existing SCW Object Storage credentials in root `.env`: `DOC_STORAGE_REGION_PROD`, `DOC_STORAGE_ENDPOINT_PROD`, `DOC_STORAGE_ACCESS_KEY_PROD`, `DOC_STORAGE_SECRET_KEY_PROD`. Reuse for pg backup (mutualised IAM, segmented bucket).
  - [ ] Add operator-side bucket provisioning step (run from root `.env` context): `scw object bucket create name=sentropic-pgbackup region="$DOC_STORAGE_REGION_PROD" project-id="$SCW_DEFAULT_PROJECT_ID"`. Document the exact CLI invocation in `deploy/scw/README.md`. The bucket is created **once** by the operator, never by the cluster, never by Make.
  - [ ] Add new env entries in root `.env`: `export PG_BACKUP_BUCKET=sentropic-pgbackup` (mandatory), `export PG_BACKUP_REGION=$DOC_STORAGE_REGION_PROD` (optional override), `export PG_BACKUP_ENDPOINT=$DOC_STORAGE_ENDPOINT_PROD` (optional override). All resolved at sealing time, not hardcoded into manifests.
  - [ ] Add `deploy/scw/06-sealed-sentropic-pgbackup.yaml` SealedSecret containing: `S3_ACCESS_KEY` (=`DOC_STORAGE_ACCESS_KEY_PROD`), `S3_SECRET_KEY` (=`DOC_STORAGE_SECRET_KEY_PROD`), `S3_BUCKET` (=`PG_BACKUP_BUCKET`), `S3_REGION`, `S3_ENDPOINT`. Sealed from root `.env` via `make scw-seal-secret`.
  - [ ] Add `deploy/scw/70-pgbackup-cronjob.yaml`:
    - Schedule: nightly, e.g. `15 02 * * *` UTC.
    - Image: minimal alpine with `postgresql-client` and `aws-cli` (or `mc` for SCW Object Storage), pinned tag.
    - Command: `pg_dump $POSTGRES_*` then `aws s3 cp` to `s3://$S3_BUCKET/<timestamped-key>` with timestamped key prefix.
    - Bucket name read from SealedSecret env var `S3_BUCKET` (not hardcoded in the manifest).
    - Restart policy: `OnFailure`. History limits: `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 3`.
    - Resource requests/limits within tenant quota; document quota delta.
  - [ ] Add `make scw-pgbackup-now` operator target to manually trigger the CronJob (`kubectl create job --from=cronjob/...`). (BR37b-EX1)
  - [ ] Add `make scw-pgbackup-restore` operator target that pulls a chosen dump from the bucket (using `$PG_BACKUP_BUCKET`), validates checksum, and runs `psql` restore into a scratch DB for verification. Restore into the live DB stays manual to avoid accidental data loss. (BR37b-EX1)
  - [ ] Document bucket lifecycle policy guidance (retention) in `deploy/scw/README.md`; lifecycle policy set via SCW CLI or console, not in this repo.
  - [ ] Lot gate:
    - [ ] Operator-side bucket created via SCW CLI, listed by `scw object bucket list`.
    - [ ] Manual trigger via `make scw-pgbackup-now KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b` produces a dump object in `s3://sentropic-pgbackup/`.
    - [ ] UAT k8s: `make scw-pgbackup-restore KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b` restores into scratch DB; record row counts and a `select count(*) from organizations` sanity check.
    - [ ] Tenant ResourceQuota remains within budget after CronJob registration.

- [ ] **Lot 4 — Public DNS + Ingress + cert-manager via Cloudflare DNS-01 (BR37b-FL4)** _(→ MOVED to BR-37c)_
  - [ ] Confirmed hostname: `sentropic.sent-tech.ca` (Cloudflare-managed zone `sent-tech.ca`). No DNS record creation in this repo — operator creates it via Cloudflare dashboard or `flarectl`/API once the Ingress controller has a public IP.
  - [ ] Operator-side: create Cloudflare API token scoped to `Zone / DNS / Edit` on `sent-tech.ca` only. Add `export CLOUDFLARE_API_TOKEN=<token>` to root `.env`. Document the token scope and rotation procedure in `deploy/scw/README.md`.
  - [ ] Decide cert-manager install method (manifest-only vs Helm). Preferred: official manifest install pinned to a specific version, deployed into namespace `cert-manager`.
  - [ ] Add `deploy/scw/02-cert-manager.yaml` (or split) for CRDs + controller deployment.
  - [ ] Add `deploy/scw/04-sealed-cloudflare-api-token.yaml` SealedSecret in namespace `cert-manager` containing `api-token`. Sealed from root `.env` `CLOUDFLARE_API_TOKEN` via `make scw-seal-secret`.
  - [ ] Add `deploy/scw/03-clusterissuer-letsencrypt.yaml` with two `ClusterIssuer` resources (`letsencrypt-staging`, `letsencrypt-prod`), both using the ACME DNS-01 solver with the `cloudflare` provider and a `secretKeyRef` to the Cloudflare API token sealed in cert-manager namespace. Choose `letsencrypt-staging` first for the smoke loop, then flip the Ingress annotation to `letsencrypt-prod` after one staging issuance succeeds.
  - [ ] Update `deploy/scw/60-ingress.yaml` to define the real Ingress for api + ui:
    - Host: `sentropic.sent-tech.ca` (and optionally api/ui split-hosts if needed; otherwise single host with path routing).
    - TLS section pointing to the active ClusterIssuer (`letsencrypt-staging` initially, then `letsencrypt-prod`).
    - DNS-01 unlocks wildcard if needed: keep wildcard optional for BR-37b; default is the single host certificate.
    - Ingress class: Nginx (already on the Kapsule by operator-side), or whichever class the `poc-k8s` operator pool exposes.
  - [ ] Add `make scw-dns-smoke` target (append-only) that resolves `sentropic.sent-tech.ca`, hits `https://sentropic.sent-tech.ca/api/v1/health` and `https://sentropic.sent-tech.ca/`, and prints TLS subject + issuer for verification. (BR37b-EX1)
  - [ ] Lot gate:
    - [ ] `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b SCW_INGRESS=1` applies cert-manager controller, sealed Cloudflare token, both ClusterIssuers, and the Ingress.
    - [ ] Ingress controller exposes a public IP/hostname; operator creates the Cloudflare A/AAAA/CNAME record for `sentropic.sent-tech.ca` pointing to it.
    - [ ] cert-manager issues the staging certificate via DNS-01; manual `kubectl describe certificate -n sentropic` confirms `READY=True`.
    - [ ] Flip Ingress annotation to `letsencrypt-prod`; rollout shows fresh prod certificate.
    - [ ] UAT public: `make scw-dns-smoke ENV=test-feat-deploy-poc-k8s-37b` returns 200 for api and ui with a trusted TLS certificate (Let's Encrypt R3 or equivalent).

- [ ] **Lot 5 — End-to-end publish → deploy-k8s → rollout → smoke validation** _(→ MOVED to BR-37c)_
  - [ ] Trigger a CI run on `feat/deploy-poc-k8s-37b` push that exercises `publish-api-image`, `publish-ui-image`, and `deploy-k8s`. If `changes` filter prevents `deploy-k8s` from running on a manifest-only diff, extend the filter under `BR37b-EX2`.
  - [ ] Verify `deploy-k8s` applies all four lots' manifests and rolls out api/ui without regression.
  - [ ] Re-run smoke matrix: `scw-smoke`, `scw-email-smoke`, `scw-dns-smoke`, `scw-pgbackup-now` (then `scw-pgbackup-restore` into scratch).
  - [ ] Record evidence in `docs/uat/2026-05-24-deploy-poc-k8s-37b.md`: CI run id, rollout statuses, smoke return codes, mail receipt screenshot, backup object listing, TLS verification output.
  - [ ] Lot gate:
    - [ ] `make scw-deploy ... ENV=test-feat-deploy-poc-k8s-37b` is idempotent: re-apply causes no resource churn.
    - [ ] UAT k8s: all four lot smokes are green.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `deploy/scw/README.md` with the new operator runbook: sealed-secrets workflow (create/rotate/recover), pg backup operate/restore, ingress/cert-manager runbook, smtp diagnostics.
  - [ ] Update or close `docs/uat/2026-05-16-deploy-poc-k8s.md` with a pointer to the BR-37b UAT doc.
  - [ ] Update `PLAN.md` §3 catalog with the BR-37b row, §4 graph with the BR-37b node, and §5 scheduling note (BR-37b is a maintenance follow-up, no wave gating). (BR37b-EX3)
  - [ ] No `spec/BRANCH_SPEC_EVOL.md` consolidation needed; BR-37b does not own a spec.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint not applicable (no app code change). Confirm `make typecheck-api` + `make typecheck-ui` + `make lint-api` + `make lint-ui` remain green on `feat/deploy-poc-k8s-37b` HEAD.
  - [ ] Retest UI: not applicable.
  - [ ] Retest API: not applicable.
  - [ ] Retest e2e: not applicable for k8s tenant changes; rely on CI matrix per `.github/workflows/ci.yml` baseline.
  - [ ] Retest AI flaky tests if signature reappears on PR CI; document and request sign-off only if observed.
  - [ ] Record explicit user sign-off if any AI flaky test is accepted.
  - [ ] Final gate step 1: create/update PR using `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md` symlink (keep `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` as roadmap pointer until BR-37b moves to `plan/done/` post-merge), push, and merge.
  - [ ] Post-merge: move `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` to `plan/done/` and update `PLAN.md` status to `done`.

## User sign-off
- **E2E flaky `05-usecase-detail.spec.ts` SSE chat-update** (run `26382665015`, commit `1ab59715`):
  - Status: `signed-off`.
  - Subject: accept the live-LLM SSE chat-field-update test as `flaky accepted` (non-systematic: failed 3×, passed clean on rerun of the same job/commit). Unrelated to the Lot 1 email migration.
  - Sign-off record:
    - User: Fabien Antoine (fabien.antoine@gmail.com)
    - Date: 2026-05-25
    - Decision: `flaky accepted`
    - Notes: Live-LLM chat-SSE tool-call nondeterminism, no chat/SSE/tool code changed in BR-37b. Rerun of `test-e2e (group-e, 05 07)` on the same commit `1ab59715` was green. Follow-up (deferred): add `e2e/tests/05-usecase-detail.spec.ts` SSE case to the `rules/testing.md` E2E AI flaky allowlist via a dedicated rules change.

## Deferred to BR-14d / future BR
- [ ] Final production hostname (beyond `sentropic.sent-tech.ca`) and migration off the `poc-k8s` cluster name when a more solid cluster is provisioned. BR-37b runs on `poc-k8s` but treats the workload as production.
- [ ] Vault or External Secrets Operator (if scale beyond the shared Kapsule requires backend-managed secrets, multi-tenant separation, or HSM-backed encryption).
- [ ] Postgres backup automation beyond CronJob: CNPG operator, point-in-time recovery, WAL streaming, multi-region replication.
- [ ] Full dev/CI migration to Kubernetes or k3d (root dev stays docker-compose).
- [ ] Wildcard cert for `*.sent-tech.ca` if multiple subdomains are introduced (DNS-01 already supports it; out of scope as long as the single host suffices).
- [ ] Remaining production Scaleway object, secret, workflow, dashboard, DNS, OAuth, and residual codebase rename finalization (BR-14d scope).
