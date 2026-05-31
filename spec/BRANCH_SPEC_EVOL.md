# BR-14e — Sentropic Codebase Finalization (Design / Spec)

Status: DRAFT — Opus 4.8 self adversarial pass done (findings folded in). **Codex 5.5-high pass UNAVAILABLE** (3 attempts failed: `gpt-5.5-codex` unsupported on ChatGPT account; default model returned "high demand"/stream-disconnect). NOT double-reviewed yet — retry Codex when the API recovers before final gate. Then fold into `BRANCH.md` lots + `plan/14e`. Delete this file before final tests.

## 1. Goal

Remove every `Top AI Ideas` / `top-ai-ideas` / `topAiIdeas` / `top-ai-ideas-*` occurrence from the codebase and its build/deploy/runtime identity, leaving `Sentropic` as the single brand and `sentropic*` as the single machine identity. The few residuals that must stay (historical records, in-the-wild export markers, out-of-repo console config) are listed in a residual report for BR-14d closure.

## 2. Locked decisions (do not re-litigate)

- D1 **Scope** = FULL sweep now (BR-14a/14b merged). No display/slug phasing.
- D2 **Docs** = include living docs; historical evidence docs stay verbatim.
- D3 **Extensions** = republication expected. Verified: NO public store publish exists (no `vsce publish`/webstore/ovsx); distribution is self-hosted download via `CHROME_EXTENSION_DOWNLOAD_URL` / `VSCODE_EXTENSION_DOWNLOAD_URL`. "Republication" = rebuild self-hosted `.zip`/`.vsix` under new names + repoint download paths. No BR-12/public-store dependency.
- D4 **UAT** = full multi-surface (web + live email + Chrome ext loaded unpacked + VSCode ext from vsix) before merge + post-merge live smoke.
- D5 **Machine identity** = rename everything (assumed breakage): npm names, VSCode publisher+name, Chrome storage keys, manifest name.
- D6 **Infra images** = rename source images to `sentropic-*`, remove the BR-37 retag bridge, with scope exceptions for `Makefile` / `docker-compose*.yml` / `ci.yml`; prove a green k8s rollout before merge.
- D7 **Bucket** = migrate the docs bucket too.
- D8 **Sequencing** = single BR-14e PR; merge only when CI green AND green k8s deploy proven.

## 3. Verified facts (load-bearing)

- Base: rebase onto current `origin/main` (`ff32a06f`, #199) at implementation start; scope identical there (display 44/20, slug 64/33). `packages/**` = 0 brand strings → no `enforce-package-bump` trigger.
- Single public host `sentropic.sent-tech.ca`; nginx in the UI image proxies `/api` internally (`deploy/k8s/60-ingress.yaml`). Legacy `top-ai-ideas-api.sent-tech.ca` is DECOMMISSIONED.
- **Functional bug (not cosmetic):** Chrome ext prod config + ChatWidget + manifest match list point at the dead host — `extension-config.ts` `BASE_DEFAULT_CONFIGS.prod` (`apiBaseUrl https://top-ai-ideas-api.sent-tech.ca/api/v1`, `appBaseUrl https://top-ai-ideas.sent-tech.ca`), `background.ts`, `content.ts:16`, `ChatWidget.svelte:194`, and `manifest.json:28` `exclude_matches`. Rebrand to `sentropic.sent-tech.ca` repairs it.
- k8s already pulls `sentropic-api`/`sentropic-ui` (`30-api.yaml:78`, `40-ui.yaml:59`). Images are BUILT `top-ai-ideas-*` (`Makefile:37-38`, `docker-compose.yml:3`, `docker-compose.dev.yml:84`) then RETAGGED to `sentropic-*` before push (`ci.yml:732,748-755,776,792-799`). Renaming source + dropping retag is Lot 3; k8s refs already correct.
- **Bucket name is NOT a DB column (verified).** `api/src/db/schema.ts` has only `storage_key` (bucket-RELATIVE object path; `:427`, `:459`), no `bucket` column. Uploaded docs resolve the bucket from `DOC_STORAGE_BUCKET` env at read time (`storage-s3.ts:24,67`). ⇒ no DB schema migration. **Nuance (keep old bucket alive during cutover):** generated DOCX/PPTX **job results** persist `storageBucket` in job-result JSON (`chat-service.ts:4466,4567`, `queue-manager.ts:2922`), read back with fallback `result.storageBucket || getDocumentsBucketName()` (`docx.ts:189`, `pptx.ts:57`, `queue-manager.ts:3615`). Old completed jobs pin the OLD bucket → keep old bucket readable until they age out. Uploaded docs (`storage_key` only) follow env automatically.
- Bucket value `top-ai-ideas-docs` is NOT in repo — `DOC_STORAGE_BUCKET` is a SealedSecret (`05-sealed-sentropic-api.yaml`). Confirm real value from cluster first.
- WebAuthn RP **ID** = `sent-tech.ca` → display/RP-name rebrand does NOT invalidate passkeys. `SCW_TEM_FROM_NAME` + `WEBAUTHN_RP_NAME` already `Sentropic` in k8s; align code defaults.
- Static assets (`hero-tech-cover.jpg`, `footer*.jpg`, `favicon.*`) are generic abstract art, no brand text → no asset rebrand.
- import/export marker `source: 'top-ai-ideas'` (`import-export.ts:968`) is output-only, NOT validated on import → safe to rename; declare a format-marker change (old archives keep old value = documented residual).
- Google OAuth redirect base is env-driven (`AUTH_CALLBACK_BASE_URL`, already sentropic); no registered-client string in repo. The Google Cloud console redirect-URI list is an OUT-OF-REPO operator check (residual report).

## 4. Lots

- **Lot 0 — Baseline** (DONE): worktree, PLAN/plan-14d recovery (`4c46edfb`). At impl start: rebase onto `origin/main` `ff32a06f`.
- **Lot 1 — Display sweep** (`Top AI Ideas`→`Sentropic`), 44 occ / 20 files: locales fr/en (titles + `reportTitle` + SENT-tech `p1/p2/p3`, brand-only); emails `magic-link.ts`/`email-verification.ts` (subjects+signatures); `openapi/export.ts` title, `app.ts`, `routes/auth/session.ts`, `webauthn-config.ts` RP-name default; `docx-service.ts` report title; extension displayNames (`vscode-ext/package.json` displayName + contributes label, `chrome-ext/manifest.json` name, popup/sidepanel titles, `content.ts`/`background.ts`/`extension-auth.ts`, `vscode-ext/extension.ts`); web titles (`+layout.svelte`, `dashboard/+page.svelte`); fixture `api/tests/utils/auth-helper.ts`.
- **Lot 2 — Machine identity + slug + dead-host fix**:
  - npm names `top-ai-ideas-api`→`sentropic-api`, `top-ai-ideas-ui`→`sentropic-ui`; regenerate BOTH lockfiles via make/Docker (never host npm). (Root `package.json` name is ALREADY `sentropic-workspace` — no change.)
  - VSCode `name`/`publisher`→`sentropic*`, vsix artifact name + `package-vsix.js` tags; `scripts/openvscode-dev-entrypoint.sh:5-6` dev-extension id (breaks once publisher/name change).
  - Chrome storage keys `topAiIdeas:*`→`sentropic:*` (6 keys; forces re-auth/re-config → also clears dead-host cache) + DOM host id `top-ai-ideas-ext`→`sentropic-ext` (`content.ts:177,181`).
  - Dead-host fix `top-ai-ideas[-api].sent-tech.ca`→`sentropic.sent-tech.ca` (single host, `/api`) across `extension-config.ts`, `background.ts`, `content.ts:16`, `ChatWidget.svelte:194` AND `manifest.json:28` exclude_matches (lockstep).
  - Download paths + zip/vsix names (`chrome-extension.ts`, `vscode-extension.ts`, `package-extension-zip.js`); import/export `source` marker (format-marker change); locale slug refs.
- **Lot 3 — Infra image rename** (EX1 `Makefile`, EX2 `docker-compose*.yml`, EX3 `ci.yml`): `API_IMAGE_NAME`/`UI_IMAGE_NAME` + compose defaults + `SOURCE_*_IMAGE_NAME`→`sentropic-*`; remove retag step; keep `:main` tag stable; confirm `30-api.yaml`/`40-ui.yaml` already `sentropic-*` (no change). Grep `IMAGE_NAME` repo-wide; change atomically (a single missed ref breaks `make build`/`make dev`).
- **Lot 4 — Tests/fixtures + gates**: update fixtures `api/tests/**`, `ui/tests/**`, and e2e — including the **assertion** `e2e/tests/06-settings.spec.ts:91,106` (download URL string — change route default + assertion in lockstep) and `e2e/tests/fixtures/README.md`. Note e2e fixtures use `.com` not `.ca`; verify no assertion pins `.com`. Run typecheck, lint, test-api, test-ui, build, e2e.
- **Lot 5 — Living docs + misc**: `README.md` (display+slug); `TODO.md:1` title; `TRANSITION.md` non-historical lines; `scripts/smoke-restore.sh` test-data names if present. EXCLUDE `.graphify/**` (generated artifact, 242 `TOP_AI` + 58 slug — re-appears on next graphify run). Leave historical evidence verbatim (`docs/uat/2026-05-28-decommission-*`, `plan/done/**`).
- **Lot 6 — Ops: bucket migration** (config + object copy, NO DB migration — bucket is env-resolved, keys are bucket-relative): (1) confirm real `DOC_STORAGE_BUCKET` from cluster; (2) create `sentropic-docs`, copy all objects preserving keys; (3) reseal `DOC_STORAGE_BUCKET=sentropic-docs` + redeploy; (4) verify download/export of a PRE-EXISTING doc + a new upload; (5) delete old bucket only after verification. Because keys are bucket-relative, existing `storage_key` rows resolve unchanged once env points at the new bucket. No live SCW/cluster access for the agent → operator hand-off in residual report (decision "migrate" stays).
- **Lot N — UAT + deploy proof + PR**: multi-surface UAT (§5); CI green; prove green image build+push+rollout on k8s; PR from `BRANCH.md`; post-merge live smoke.

## 5. UAT (multi-surface, D4)

- Web: landing/login titles Sentropic; magic-link + verification emails (maildev local → live TEM) Sentropic subject+signature; DOCX report title Sentropic.
- Chrome ext: load unpacked from rebuilt artifact; popup/side-panel/action titles Sentropic; config re-fetch resolves `sentropic.sent-tech.ca` (NOT dead host); auth + a tab-tool round-trip after storage-key change (re-auth expected).
- VSCode ext: install rebuilt `.vsix`; displayName Sentropic; chat webview connects.
- Post-merge (auto-deploy): live smoke on `sentropic.sent-tech.ca` (landing + 1 real magic-link email) + bucket download/export of a pre-existing doc.

## 6. Risks / exceptions

- BR14e-EX1/2/3 = `Makefile` / `docker-compose*.yml` / `ci.yml` (image rename). Rationale: single-PR zero-residual brand; impact: image build/push path; rollback: revert the three files restores the retag bridge.
- Auto-deploy on merge → a wrong/missed image name breaks prod. Gate: prove CI build+push of `sentropic-*` AND green rollout before merge; grep `IMAGE_NAME` repo-wide.
- Bucket = live user data (S3 objects) → copy-verify-cutover-delete; never delete old before verifying new; needs SCW creds + cluster (no DB migration; else operator hand-off).
- Chrome storage-key rename forces re-auth/re-config for existing ext users (accepted; also fixes dead-host cache).
- Lockfile regen + builds via make/Docker only.

## 7. Out of scope / residual (for BR-14d report)

- Historical evidence docs keep the old name (decommission record).
- In-the-wild export archives carry `source: top-ai-ideas` (format-marker change, not retro-rewritten).
- Google Cloud console OAuth redirect-URI list (out-of-repo operator check).
- `.graphify/**` generated artifacts (regenerated, not hand-edited).
- BR-14d closes once this branch's residual report is delivered; no standalone ops branch.
