# W0 dispatch reservations

The owner's [Q1–Q4 answers](owner-decisions.md) supersede the original plan's staffing and window requirements. The owner (rhanka) holds all human roles as principal operator, including infrastructure, promotion, migration, backup, rotation and restore; agents execute the work. The shared-file assignments below retain one writer per concern under that ownership. Independent reviews remain between distinct AIs; a coder does not review its own work.

No staffed windows or temporal slot reservations are required for W0 acceptance because there are no users. T1/T2/T3/T4/TG/T5 below describe technical integration order and file ownership. Port/worktree isolation and technical rollback ability remain required. SC rechecks each live port immediately before service startup and imports these records through its designated Track writer. No downstream worktree or service was created by W0.

## Migration and storage boundaries

- **W1 sole host migration: `api/drizzle/control/0017_app_artifact_host.sql`**, plus generator-required control metadata and bounded schema/runner integration. No product migration reserved for this train. Package artifacts migration assets are consumed unchanged through W1's single executor/journal; do not renumber upstream assets into duplicate host migrations.
- `0012`–`0016` belong to D2, despite main ending at `0011`: `tmp/worktrees/session-content-consent/BRANCH.md:59,101` records conductor ratification on 17 October. Its files cover consent, epoch pins, purge and object reservations. Cowork's `0009` reservation is also retained. W0's sibling scan found no control `0017` file; SC must reconcile any nonlocal unpublished reservation before W1 allocates it.
- Product source maximum `0043`, control source maximum `0011` are not applied production frontiers. B02 supplies live checksums and both migration journals (`drizzle.__drizzle_migrations`, `public.__drizzle_control_migrations`); W5 compares them before any approved additive migration.
- API remains the sole migration authority. IdP/content start neither migrations nor other listeners. Additive host tables and private artifact blobs stay separate from legacy document/chat/comments stores and D2 buckets/credentials.

## Ports and worktrees

Ports are listed as API/UI/Maildev UI. The test block follows branch-number 142 slots 0–4, then 143 slots 0–1; e2e uses 144 slots 0–4, then 145 slots 0–1 (`9000/5200/1100 + 5*number + slot`). These are allocation coordinates, not claims that those branch IDs are assigned. SC owns namespace/number reconciliation.

| Lot / sole runtime slot owner | Reserved worktree | Test environment : ports | E2E environment : ports |
|---|---|---|---|
| W0 / C-W0 | `tmp/worktrees/app-cm-w0` | `test-app-cm-w0`: 9710/5910/1810 | `e2e-app-cm-w0`: 9720/5920/1820 |
| W1 / C-W1 | `tmp/worktrees/app-cm-w1` | `test-app-cm-w1`: 9711/5911/1811 | `e2e-app-cm-w1`: 9721/5921/1821 |
| W2 / C-W2 | `tmp/worktrees/app-cm-w2` | `test-app-cm-w2`: 9712/5912/1812 | `e2e-app-cm-w2`: 9722/5922/1822 |
| W3 / C-W3 | `tmp/worktrees/app-cm-w3` | `test-app-cm-w3`: 9713/5913/1813 | `e2e-app-cm-w3`: 9723/5923/1823 |
| W4 / C-W4 | `tmp/worktrees/app-cm-w4` | `test-app-cm-w4`: 9714/5914/1814 | `e2e-app-cm-w4`: 9724/5924/1824 |
| P / C-P | `tmp/worktrees/app-cm-p` | `test-app-cm-p`: 9715/5915/1815 | `e2e-app-cm-p`: 9725/5925/1825 |
| W5 / C-W5 | `tmp/worktrees/app-cm-w5` | `test-app-cm-w5`: 9716/5916/1816 | `e2e-app-cm-w5`: 9726/5926/1826 |

W3 content host reserves local 9717 test / 9727 e2e; internal `PORT=8791` and Service target 8791 for the additional process. Keep `VITE_API_BASE_URL` aligned with each API port. Pass all three app ports on every runtime command and launch packet. No OAuth callback is assumed registered for these ports; exact local callback/origin registrations gate live OAuth browser checks.

At approximately 23:34 UTC, `ss -H -ltn`, read-only Docker port inventory and sibling branch declarations found no listeners/declared allocation for the selected block. Existing O1 **9495/5695/1595** was detected and excluded even though idle. Active D2 **9381/5581/1481**, D2 e2e **9382/5582/1482**, root dev **8787/5173/1080**, and other owners' **9555/5755/1655**, **9580/1680**, focus **5599/5607/5611** remain untouched. A free-port observation is time-bound, not a lock.

## Six-slot train and shared-file writers

| Slot / sole integration owner | Bounded concern / shared ownership transfer |
|---|---|
| T1 / C-W1, SC serializes | W1 host services, `api/src/db/run-migrations.ts`, reserved `0017`/metadata; `api/package.json`, root/API locks. Release locks to T2 only after integration |
| T2 / C-W2 | W2 registry, `api/src/app.ts`, MCP module and verified adapter seam; existing resources factory where required. Release resources seam to T3 |
| T3 / C-W3 | W3 activation/content entrypoint, API Dockerfile, **Makefile/CI**, all I app manifests/base+overlays; KO provisions external DNS/IAM/TLS/bucket resources and supplies receipts |
| T4 / C-W4 | W4 context/source/callers, catalogue composition and UI. No parallel writer to catalogue/executor; integrate W3 at exit |
| TG / C-P, SC accountable | P workflow/verifier/trust/promote/scripts; **Makefile/CI only after T3**, deployment documentation; tenant operator configures Environment/RBAC |
| T5 / C-W5 + tenant operator | Integrated qualification, runbook, release pins and bounded final fixes after TG; separate production GO/approval and 24 h observation |

At most four active branches and one shared CI merge slot; this concurrency constraint does not require a staffed booking. I/P may prepare orthogonal files from W0; they do not gain shared Makefile/CI write ownership early. C defaults to Muse spark 1.3 xhigh; Sol 6.1 xhigh substitutes while quota applies. An implementation handoff transfers the same branch/head and remaining checks; the coder cannot serve as its own R instance. R is independent Sol 6.1 xhigh + Astra max, findings reconciled on the final head.

## Downstream branch-plan exceptions and estimates

- **BR-CM-W3-EX1 (T3)** must appear in W3's BRANCH.md before edits: bounded Makefile content hash/build/image checks/preprod digest targets, API Docker build/copy, CI API filter/check, I base/overlay manifests. Reason: ship the real content entrypoint. Impact: one shared API/IdP/content image and added content Deployment. Rollback: re-pin prior qualified image/config, close activation/publication and fence/drain the added host. No unrelated Compose/CI refactor.
- **BR-CM-P-EX2 (TG)** must appear in P's BRANCH.md: release/test/backup Make targets, release workflow/scripts, bounded CI gate wiring and deploy docs. Reason: enforce attestation and native approval. Impact: protected production execution path. Rollback: disable dispatch/revoke automation credentials while preserving images/backups. SC assigns numeric branch aliases if its scope checker requires them.
- T3 owns **all** I app manifests: `deploy/k8s/base/artifact-content-{deployment,service,configmap,networkpolicy}.yaml`, base resource registration, both overlay registrations and `artifact-content-{ingress,certificate}.yaml`. Additional external infra PR/approval waits remain B06; no hidden app merge slot.
- Keep the same API image for API/IdP/content, compiling/copying `/workspace/apps/artifact-content/dist/index.js`, working directory `/workspace`, command `node apps/artifact-content/dist/index.js`; hash/filter inputs include content sources and all runtime/build inputs. Qualify the pruned entrypoint and content-only digest change in T3.
- No prototype evidence required a compatibility PR. T3 and T4 remain unmeasured 13.3 h assumptions; any necessary split adds its own integration step/cycle. Baseline allowance remains 82.6 h serial + 26.6 h reserve + 24 h observation = **133.2 h + critical-path waits Δ**. Q1 resolves human ownership and Q2 removes staffed-window/slot-booking waits. Missing technical evidence, infrastructure, CI/review and action approvals can still add Δ. Friday 23 October remains the conditional target; latest production start preserving observation is 24 October 23:59 Toronto. Technical rollback remains required; no unconditional cutover date is promised.
