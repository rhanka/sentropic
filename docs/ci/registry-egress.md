# CI registry egress: October 2026

## Finding and chosen transport

The early-October fan-out is confirmed, but option (a) already exists on the audited `origin/main`, `c107f6abd70e47e0aba33ab4afad01f8dafe4534`. API consumers switched to the tested Actions artifact on October 4 (`ec018720d`, with the IdP lane in `d8c393241`). E2E/UI consumers switched on October 28 (`c8ec01237`, PR #811). Current CI builds each API, API-tool, UI and E2E candidate once, with BuildKit Actions layer caches, then distributes compressed archives and identity receipts.

This wagon retains that transport, removes unused Scaleway credentials from five internal jobs, and adds required CI regression checks. It does not introduce GHCR, rebuild a deployment candidate, change test membership, or claim new savings for a fix already on main. **Marginal internal Scaleway egress before/after this wagon: 0 → 0 GB/run.**

## October workload

GitHub API query, UTC window: `repos/rhanka/sentropic/actions/workflows/ci.yml/runs?created=2026-10-01T00:00:00Z..2026-10-31T23:59:59Z`.

The API reports **1,833 distinct runs**. Five disjoint weekly windows, paginated at 100 runs/page, independently reproduce all 1,833 IDs without GitHub's 1,000-result search cap. Events: 1,578 pull requests, 121 pushes, 134 dispatches. Conclusions: 705 successful, 736 failed, 392 cancelled. The recorded latest attempt numbers sum to 1,962; 102 run IDs have multiple attempts. Runs and attempts are different denominators.

The reported invoice is 5,339 GB / EUR 176 for October versus 944 GB for September: 5.66 times the traffic, and **2.913 GB per October run** (2.721 GB per attempt). These are account-wide averages, not measured CI-only bytes.

## Expanded pull count

Counts below cover API/E2E pulls in browser jobs, on a full selected run. UI pulls and producer reuse are additional historical traffic.

| Workflow evidence | E2E shards | VSCode | IdP screens | API pulls/run | E2E pulls/run |
| --- | ---: | ---: | ---: | ---: | ---: |
| October 2, run [37071526406](https://github.com/rhanka/sentropic/actions/runs/37071526406), source `7d1002505` | 5 | 1 | 1 | 7 | 7 |
| October 15, run [38751958624](https://github.com/rhanka/sentropic/actions/runs/38751958624), source `e2e854313` | 5 | 1 | 1 | 0 | 6 |
| October 27, run [40603516452](https://github.com/rhanka/sentropic/actions/runs/40603516452), source `a6545c732` | 5 | 1 | 1 | 0 | 6 |
| Audited main / this wagon | 6 | 1 | 1 | 0 | 0 |

The historical runs' job-step receipts confirm successful pulls. The modern matrix has six shards; `max-parallel: 5` limits concurrency, not membership. Eight current browser executions receive artifacts without these registry pulls.

## Measured payload and before/after estimate

Registry evidence was captured on November 6 using manifest layer descriptors and image config history, without downloading image payloads. Units here are decimal GB (1,000,000,000 bytes); stored totals deduplicate layer digests across tags. The modeled October/current images use gzip layers. Some retained older images use uncompressed OCI tar layers; their recorded storage is not a compressed-image size.

| Registry repository | Current tags | Unique stored layers | Representative compressed image |
| --- | ---: | ---: | ---: |
| `sentropic-api` | 179 | 66.340 GB | October tag median 0.531225272 GB; current `main` 0.171159327 GB |
| `sentropic-e2e` | 28 | 18.978 GB | October tag median 0.740461424 GB |

The storage totals match the reported 66/19 GB, but the live tag counts do not match five tags. Dividing stored bytes by five does not estimate a pull. API manifest payloads span 0.166876–1.313196 GB across retained history (mixed compression); E2E spans 0.739343–0.740463 GB.

| Scenario | API/E2E registry GB per full run | GB/month at 1,833 full selected runs |
| --- | ---: | ---: |
| Early October: `7 × (0.531225272 + 0.740461424)` | 8.902 | 16,317 |
| Mid/late October: `6 × 0.740461424` | 4.443 | 8,144 |
| Current artifact transport, before this wagon | 0 | 0 |
| Current artifact transport, after this wagon | 0 | 0 |

These first two rows are full-run workload projections, not reconstructed invoices. Changed-path selection, early failures/cancellations, partial pulls, runner layer reuse and historical transport changes lower the realized fan-out. Another 298 runs were created after the October 28 artifact merge; their branch heads can still contain older workflows. The scale supports CI fan-out as a substantial source, but registry access logs or billing attribution are needed to assign an exact fraction of the EUR 176. Production deployments, daily live qualification and the UI publisher's remaining registry pull stay outside the zero-internal-pull claim.

## Actions cost and BR-82 preservation

Run [42134359400](https://github.com/rhanka/sentropic/actions/runs/42134359400) exposes these actual compressed artifact sizes: API 176,790,171 bytes; API-tool 350,598,635; UI 110,189,897; E2E 518,928,737. Total **1.156507440 GB/run**, retained for one day. Upload compression is zero because the archives are already zstd-compressed. This is existing storage, unchanged by the wagon; Actions downloads incur no Scaleway egress.

The repository is public and standard hosted-runner compute is free. [GitHub's billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions) quotes shared artifact storage at USD 0.25/GiB-month beyond allowances. Conservatively applying that rate to all four artifacts on all 1,833 runs for 24 hours gives **USD 15.92 for a 31-day month before allowances**; selection/retention reduce that envelope. This is a modeled upper bound, not an account bill. Retaining option (a) adds no storage or compute. GHCR would also remove Scaleway download charges, but adds registry publication/access/retention wiring without further reducing the current zero Scaleway fan-out; a total GitHub bill comparison requires account usage.

The API archive, its receipt and `.tmp/ci-prod-image/api-image-id` remain unchanged. `load-api` verifies the archive and loaded image; tests execute that identity. Publication loads the same artifact and retains tag-collision checks; BR-82 rejects a published digest different from tested bytes before deployment. No publisher/deploy credentials, release barriers, tests, timeouts or retries were changed.

## Separate API slimming lot proposal — not implemented

Historical API tag `130a1f` (October 27) is 643,071,821 compressed bytes. Its `npm ci` layer alone is **540,166,839 bytes (84.0%)**; Node/Alpine contributes 57,231,433 bytes. The former `FROM base AS production` retained the installation/download-cache layers even after `npm prune` and later deletion. The largest old tag, `b98669` (August 1), stores 1.313 GB of uncompressed OCI tar layers, including a 964.5 MB install layer. Eighty-two retained API tags predate October.

Main already uses a fresh runtime and copies pruned dependencies; `main` is 171,159,327 bytes, **73.4% smaller** than `130a1f`. Its remaining dominant layer is the broad production-workspace copy (**100,604,373 bytes**), followed by the shared Node base (57,231,433 bytes). Repeating the fresh-runtime fix would duplicate existing work.

Proposed lot **API-SLIM**, owner CI/API maintainers:

1. Inventory the fresh runtime's files and replace the whole-workspace copy with a measured runtime allowlist: production dependencies/workspace links, API/IdP/content bundles, migrations and runtime SQL/static assets. Quantify source/test/build residue before choosing a byte budget.
2. Keep API, IdP and content on the same canonical tested image. Qualify native dependencies, boot/migrations, content SQL assets, IdP screens, restore and the existing BR-82 receipt/digest refusals. Accept only a demonstrated compressed-byte reduction with all gates unchanged.
3. Propose a separate registry retention policy from a dry-run inventory of deployed/rollback/receipt-referenced digests. Review protected references before any tag removal. This addresses the 66 GB accumulated history independently of runtime size; this wagon deletes nothing.

## Validation and train handoff

`make test-ci-dag test-ci-image-receipts test-ci-release-receipts API_PORT=9666 UI_PORT=5866 MAILDEV_UI_PORT=1766 ENV=test-ci-registry-egress`: **10 + 16 + 40 tests passed**. The credential guard failed on the unmodified workflow before the five environment blocks were removed. Branch/scope checks passed mechanically.

This is a wagon with no PR or CI dispatch. The dated train owns consolidated independent review and required CI. Its designated Track writer imports `BRANCH.md` and API-SLIM; this concurrent lane does not append the shared Track journal. Owner report and raw measurements: `.tmp/rv/ci-registry-egress.md` and sibling `ci-registry-egress-*` evidence files in the common workspace.
