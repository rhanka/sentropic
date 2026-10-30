# PR #837 integration review corrections

Author: codex / gpt-6.1-sol / high. Source review: `pr837_muse_r1.md`,
Muse Wonder full xhigh, target `74e2b7a2c442c32fc14f764bb1e02b1a0dbec1e7`.
This receipt distinguishes source-lot reviews from review of the integration.

## 1. Exact-head CI

Run `40951325681` at `c6048eb29` passed the dossier size gate. Its
`3691474`-byte JS failure is the deliberately oversized baseline fixture;
the typical fixture has `249234` JS bytes and `291943` portable bytes, with
no violations. Module attribution identifies the baseline's intentionally
reimported `governance-routes.json`, not a server or Node dependency.
The actual failing step in job `123738620065` is installed activation
conformance: the missing `ACTIVATION_DISPOSABLE` refusal starts a nested
Vitest runner and exceeds the unchanged 5000ms test limit. The correction
extracts the same suite startup guard and executes it directly with Node.
All three missing-variable refusals and all nine installed conformance tests
remain required; no budget, timeout, production code or skip is changed.
Local Docker verification passes the full `build-artifact-budget` target
(14 tests, 2496 equivalence cases, 1758 geometry scenes) and the dedicated
`test-lazy-package-activation` target (9/9, no pending tests or type errors).

Job `123666763408` in run `40929658189` failed the resources fence inventory:
W3.a added `POST /resources/artifacts/reader-activation`, but W2.b's independent
immutable route inventory omitted it. The production route and fences already
include it. Correction `5afdf6386` adds that method/path to the immutable list;
no timeout, skip, production authorization or assertion is weakened.
The scoped Docker regression passes all 69 fence tests. Completed/success CI
on the final pushed head, including endpoints shard 2 and security-container,
remains the authoritative N5 gate; the PR body records its SHA and run URL.

## 2. Rebase and patch-equivalence receipt

The historical train ended at `e86402083` on main `c37662a20`. It was rebased
onto `b7e86f5ea`, producing `4122a6f57`; `74e2b7a2c` then restored the integrated
workspace dependency. Source-lot heads are not ancestors of this replay.
Only W0 #702 is inherited through main. The merge/no-rebase claims are retired.

Reproduce the retained range comparison:

```sh
git range-diff --no-color c37662a20..e86402083 b7e86f5ea..74e2b7a2c
```

Full output SHA-256: `7d7fa900fb1b74a56b871d9776388f879e5f2219fb9f11dde262ccbe1231aeda`.
Local artifact: `.tmp/packets/pr837-range-diff.txt` in the primary checkout.
It reports 111 equal, 69 changed, 5 old-only and 6 new-only entries. Flattened
stacked merges and replay context affect commit pairing; equality of every
original commit is not claimed. The final-tree reconciliation is bounded below.

Of 192 paths changed between the old train and `74e2b7a2c`, 184 are byte-identical
to new main. The other eight are accounted for:

| Path | Reconciliation |
| --- | --- |
| `.github/workflows/ci.yml` | Main advance has the same zero-context stable patch ID `77d9305df197bccad7dfee1fc28c9fe6becfc16c`; retained integration gates remain additional. |
| `Makefile` | Main advance has the same zero-context stable patch ID `7ad7513c3b2a6727ff16c573006f4c78ba79d61e`; retained topic union remains additional. |
| `BRANCH.md` | Integration plan retained; main Q1 record appended as historical evidence; post-rebase feedback added. Correction commits update current claims separately. |
| `api/vitest.config.ts` | Two existing llm-mesh aliases move before the generic cluster-mesh alias; targets unchanged. |
| `docs/baselines/app-cm-w0/README.md` | Main's current authority index retained. |
| `docs/baselines/app-cm-w0/host-fit.md` | Main's current #796 authority moved before the historical refresh; W4.b source supersession retained. |
| `api/package-lock.json` | Reconcile main dependency pins with integrated artifacts workspace link; no artifacts 0.2.3 registry fallback. |
| `package-lock.json` | Main's engram/cluster-mesh/llm-mesh version advance and removed transitive packages; integrated artifacts workspace link retained. |

`api/package.json` is byte-identical to the old train: `74e2b7a2c` replaces the
rebase's artifacts 0.2.3 registry selector with `file:../packages/artifacts`.
Both lockfiles agree. No package source or package manifest differs from main,
so this correction requires no package publication/version bump.
Changes after `74e2b7a2c` are the fence inventory and review records only;
final-head review must cover them and every integration-only commit.

The CI repair rebases `c6048eb29` onto main `c1e592636`. Only the first
BRANCH.md patch conflicts; the integration plan wins. The activation test
correction is authorized by BR143-EX3. Package source and manifests remain
identical to main, so the Post-Rebase Gate requires no publication bump.

## 3. Review coverage

Final-head review must cover the whole main-to-head diff, especially
`d01d6c484`, `9de130718`, `94f71f234`, `b83af9389`, `4122a6f57`, `74e2b7a2c`
and these corrections. Historical lot approvals alone do not satisfy this gate.
The PR body retains the review receipts and any outstanding consensus gate.

## 4. W4.a product behavior

Approved tenant membership is a prerequisite for every chat server tool,
including in TENANT_RESOLUTION_MODE=shadow. Missing, requested or revoked
membership permits text-only chat; the model receives `catalog: unavailable`.
This affects business tools, web search/extraction, plans, documents,
comment assistant and history analysis. Owner: Antoine, product owner;
acceptance is pending explicit confirmation. No product acceptance is inferred
from fixture grants. Final-head chat lanes must also pass.

## 5. Legacy inventory disposition

Retain `createPostgresLegacyArtifactRecords(pool)` as a read-only migration
quarantine inventory, not a serving fallback. It reads only
`artifacts.idempotency_keys`. `assertArtifactReplayMigration` checks the caller,
internal and historical operation/actor keys before ensure/publish dispatch;
any existing legacy record raises `CommitQuarantineError` (`legacy-unknown`).
The public outcome is non-retriable 503 `capability_unavailable`; no legacy
success becomes an authorized receipt, no old result is served, and no new
allocation occurs under another key. Removing this inventory would bypass
that refusal. Reads use the guarded current store; writes use the coordinator.
See `packages/artifacts/docs/migration-l6.md` and its publication-security tests.

## 6. Baseline migration and schema rollback

The W0 local-restore receipt explicitly deleted both copies of
`prod-2026-10-29T04-40-00.dump` and its isolated volume. Its SHA-256 is
`ecd4b566d493a6b2ba6adbcf9e5055bf2b94f629d675f441fb4e7c3a5bc492f0`.
An older retained dump is not evidence of migration on those exact bytes.
First/second API migration execution on the restored W0 baseline remains an
explicit pre-merge gate until the source is recovered; no synthetic fixture
or empty-store migration is substituted for this rehearsal.
The schema rollback position is recorded in the baseline restore runbook.

## 7. Commit-size record

Seven replayed commits violate the 150-line rule: `8dab28051` (208),
`0ef65483b` (199), `34ef1adc5` (196), `2f7e0e65f` (181), `b97efabb9` (180),
`56ce57aac` (168), `4217bd8ca` (161). BR143-EX1 covered historical merge
content and does not exempt these replay commits. The contrary blanket claim
in BRANCH.md is amended. No retrospective approval or splitting rewrite is
claimed. New corrections stay within the limit.

## Muse r2 reconciliation (29 October 2026)

The four verdict items below retain the review's exact wording. The author
does not infer product acceptance, reconstruct deleted baseline bytes, or
submit an approval of their own PR. Serving remains closed.

1. **The head `7fd1a87cc` is conflicting with current main `36e66458a` (30 commits behind) and the PR body is stale for it. The required rebase creates a new head that needs updated patch-equivalence evidence, an updated N5 body record, and its own completed/success CI.**
   Rebased onto newer main `82a7be05b`, producing `42875f874` before these
   documentation/branch-close corrections. Conflicts: the initial BRANCH.md
   keeps the integration plan; the API environment reconciliation retains
   main's `REMOTE_ACTION_ROLE=product` and the three artifact flags at `0`
   in one env list. All 54 closed-overlay render/mutation checks pass.
   No package source or manifest differs from main: the Post-Rebase Gate
   has no touched public package requiring a registry/version comparison.
   The PR body supplies the final pushed SHA and completed CI run.
2. **W4.a's shadow-mode prerequisite is recorded with a named owner and the chat lanes are green, but Antoine's explicit product acceptance is still pending.**
   OPEN: Antoine's explicit acceptance has been requested; it has not been
   supplied. The behavior and affected tools remain stated in section 4.
   Passing final-head chat tests cannot substitute for that decision.
3. **The migration `0020` rehearsal against the restored W0 baseline remains open. The exact dump was deleted, and no first-run or idempotent second-run receipt exists.**
   OPEN: local backup, worktree, temporary and cache searches found no copy
   of the exact dump. The original restore receipt confirms both hardlinked
   paths and the restore volume were removed. Recovery source requested;
   no older dump, empty fixture or new production dump is substituted.
   Acceptance requires the SHA in section 6, isolated restore, real API
   migration execution twice, and both results. Code author owns execution
   once those bytes are available; schema rollback remains documented.
4. **Final-head consensus review, native approval, undrafting, and branch-close removal of `BRANCH.md` with C1/C2 on the resulting head are all still outstanding.**
   Final-head review and approval are recorded in the PR body with their
   actual status. Branch-close removes BRANCH.md in bounded commits; its
   scope contract is retained as a local verification input, and the full
   original plan remains readable at `42875f874:BRANCH.md`. C1/C2 must run
   again against the resulting complete main-to-head path set. Product and
   migration gates remain OPEN regardless of branch-plan removal.

### Public replay evidence

Full outputs are now accessible from the PR, replacing the local-only record.
Concatenate the fenced diff contents in comment/part order, retaining LF:

| Replay | Exact comparison | Equal / changed / old-only / new-only | Full output |
| --- | --- | --- | --- |
| 1 | `c37662a20..e86402083` vs `b7e86f5ea..74e2b7a2c` | 111 / 69 / 5 / 6 | [parts 1–6, starting here](https://github.com/rhanka/sentropic/pull/837#issuecomment-6513317846); subsequent parts: 6513318154, 6513318480, 6513318913, 6513319232, 6513319503 |
| 2 | `b7e86f5ea..c6048eb29` vs `c1e592636..b65ba7250` | 187 / 1 / 0 / 0 | [complete output](https://github.com/rhanka/sentropic/pull/837#issuecomment-6513319836) |
| 3 | `c1e592636..7fd1a87cc` vs `82a7be05b..42875f874` | 187 / 2 / 0 / 0 | [complete output](https://github.com/rhanka/sentropic/pull/837#issuecomment-6513320095) |

SHA-256 for replay 1 is recorded in section 2. Replay 2:
`a24125857c2a9a6e42f1d673de3ddaa288c298b3f47f12a024811352d511bf8d`.
Replay 3: `14df1aad9d0b02e49e355968199d70b9beeb2d5d6f09f38f8c78d85658193ff2`.
Replay 2's only changed pairing is the initial plan's replaced main context.
Replay 3 changes that same pairing plus the API env conflict described above;
all other patches pair equally, including both correction lanes.
