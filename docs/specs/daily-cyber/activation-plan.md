## 1. Exact current state

**The daily cybersecurity service is OFF.** Inspection is anchored to `origin/main` commit `441f6d184c707371bb9a38f5696e2686ad24dadc`, which matched GitHub’s `main` during this read-only audit on 2026-10-31. Tracked `file:line` references below refer to that commit.

The requested file was not created because the instruction prohibits edits and the clarification remains unanswered. This is the proposed content for `/home/antoinefa/src/sentropic/.tmp/daily-cyber/activation-plan.md`. No scan, test campaign, agent, workflow, enrollment, refresh, or activation was launched.

**Merged implementation**

| PR | Merged contribution | Current evidence and limit |
|---|---|---|
| [#840](https://github.com/rhanka/sentropic/pull/840) | Frozen Trivy S2b qualification: scanner/verifier inventories, DB acquisition, archive scans, provenance checks, failure trials and measurements. | `docs/security/trivy-s2b-qualify.md:3`, `:13`, `:21`. Qualification remains **NOT QUALIFIED**; successful qualification experiments do not admit the service. |
| [#846](https://github.com/rhanka/sentropic/pull/846) | Lockfile-exact CI installations, frozen tool profiles and installed-consumer dependency resolution. | `.security/ci-lockfile-installs.md:7`, `:11`, `:26`. Independent tool/consumer catalog SCA remains an explicit gap at `:18–20`; deterministic installation is not vulnerability clearance. |
| [#848](https://github.com/rhanka/sentropic/pull/848) | Explicit execution of the daily adapter regression suite in required CI, replacing indirect imports. | `.github/workflows/ci.yml:3273`, `Makefile:3510`. The step clears inherited `REGISTRY` and `ADMIN_EMAIL`. It does not schedule scans. |
| [#849](https://github.com/rhanka/sentropic/pull/849) | Real malicious-configuration controls, cache refusal, safe operator-field parsing and scanner cleanup/isolation regressions. | `docs/security/sec5a-safety.md:5`, `:9`, `:11`, `:15`. The hardened Log4j control finds eight CVEs while repository-controlled configuration suppresses the control report. Admission remains off. |
| [#850](https://github.com/rhanka/sentropic/pull/850) | Independent reacquisition of Cosign 3.1.4, signature objects and fresh Sigstore TUF material; offline verification and three cryptographic refusal controls. | `docs/security/sec5a-trust-custody.md:3`, `:7`, `:13`. Independent verifier/content admission is still required. The retained trust snapshot’s refresh deadline is `2026-11-06T01:22:45Z` at `:11`. |
| [#851](https://github.com/rhanka/sentropic/pull/851) | Symmetric cold/warm result and finding-inventory agreement checks. | `scripts/security/daily/trivy.mjs:148`, `scripts/security/daily/qualify-current.mjs:57`. Two agreeing reports can still omit the same component; independent expected inventories remain necessary. |
| [#852](https://github.com/rhanka/sentropic/pull/852) | TUF expiry and intra-set parent version/digest checks. | `scripts/security/daily/qualify-trust-receipt.mjs:6`, `:18`. The validator has no prior trusted state: a self-consistent older, unexpired metadata set still passes. Historical rollback protection remains open. |

All seven PRs are merged. None establishes daily-service activation.

The implementation under `scripts/security/daily/` currently comprises:

- Inventory, policy/schema validation and raw finding/register reconciliation: `inventory.mjs:62`, `:83`, `:135`; `.security/security-fix.json:15`.
- A local scan orchestrator that currently runs npm audits: `scan.mjs:19`, `:160`, `:207`.
- Trivy preparation, OCI/cache validation, immutable target checks and report adaptation: `toolchain-contract.mjs:16`, `toolchain-cache.mjs`, `toolchain-oci.mjs`, `trivy.mjs:10`, `:30`.
- Opt-in qualification scripts and receipts, wired through `qualify.mk` and `Makefile:3514`.
- Five regression suites selected by `Makefile:3511`.

**An activation implementation is still needed.** `scan.mjs:116` unconditionally records the S2b coverage blocker; `:140` rejects non-npm results; `:207` invokes `npmRunner`. `inventory.mjs:104` reports SAST unqualified. A cron invoking today’s `security-daily-scan` would produce incomplete coverage, not the requested complete daily review.

**Remaining admission gates**

| Gate | Exact remaining work |
|---|---|
| Scanner and verifier | Replace the frozen scanner containing one CRITICAL and two HIGH findings; independently admit scanner content, Cosign and the trust contract. `.security/trivy-toolchain.json:4`, `:17`, `:20`, `:34`; `docs/security/trivy-s2b-qualify.md:13`. |
| Native SAST | Qualify native Rust ast-grep in a newly reviewed immutable toolbox image, with frozen local JS/TS rules, severity mappings and positive/negative coverage fixtures. It is mandatory before the pilot. `.security/security-fix.json:42`; [daily specification:213](/home/antoinefa/src/sentropic/.tmp/daily-sec-fix/spec-plan.md:213). |
| IaC and completeness | The retained rules detect zero Compose configurations. Qualify the declared Compose/Makefile surfaces and complete per-document adaptation; establish expected package/component inventories independently of scanner output. `docs/security/trivy-s2b-qualify.md:17`; `trivy.mjs:176`. |
| Remote targets | Establish one immutable main-source cohort for API production, API toolbox and UI production, with matching producer, registry, configuration and platform identities. The retained cohort had missing API/toolbox tags and a UI mismatch; these are dated observations, not a fresh registry probe. `docs/security/trivy-s2b-qualify.md:18`, `:64`. |
| Remote execution and rebuild | Prove target-scoped pull access, successful remote scanning and bridge-path isolation. Qualify an isolated builder without a shared daemon, credentials or Python. `docs/security/trivy-s2b-qualify.md:20–21`. |
| S3 custody | Qualify trusted target/receipt custody, validated public report transfer, collector-only publication, retention and recovery. **S3 is a delivery lot, not an inferred Amazon S3 deployment.** It is separate from Sigstore trust custody and seat-secret custody. `docs/security/trivy-s2b.md:67`, `:93`; [daily specification:56](/home/antoinefa/src/sentropic/.tmp/daily-sec-fix/spec-plan.md:56). |
| Performance ≤600 s | Produce successful remote/rebuild measurements and a comparable complete CI critical path through `ci-gate` of at most 600 seconds. The retained successful sample is 685 seconds. Initial queue time must be reported separately; coverage cannot be reduced to meet the target. `docs/security/trivy-s2b-qualify.md:21`, `:62`. |
| Rollback | Existing evidence restores the blocked S2a state. Qualified-runtime recovery, native expiry controls and rollback protection against previously trusted metadata remain unproven. `docs/security/trivy-s2b-qualify.md:22`; `qualify-trust-receipt.mjs:14`. |

There is a review-evidence discrepancy worth preserving: a [#850 comment](https://github.com/rhanka/sentropic/pull/850#issuecomment-6514874779) described the original-lot review as closed. The committed receipt instead explicitly says `pending-independent-review`, publishes no review artifacts and denies runtime admission: `docs/security/sec-s2b-qualify-review.md:4`, `:13`, `:18`. A regression requires that pending status at `toolchain-contract.test.mjs:158`. The plan must use the committed evidence and obtain publishable reviews of the exact admitted candidate.

**Scheduling and OFF state**

A scheduled workflow exists, but it is **IdP identity synchronization**, with cron `40 4 * * *`: `.github/workflows/idp-identity-sync.yml:9`. No `security-daily.yml` exists on the inspected main. The general CI workflow has push, pull-request and manual triggers: `.github/workflows/ci.yml:3`.

The daily service is off for several independent reasons:

- `.security/security-fix.json:5` sets `enabled: false`; `schema.mjs:171` currently requires that disabled value.
- Scanner, verifier/content and IaC qualification flags remain false; `toolchain-contract.mjs:55` requires every admission condition.
- The scheduler, complete scan integration and S3 collector are missing.
- No repository-level `SECURITY_FIX_ENABLED` variable was returned by the live variable inventory. Missing/unreadable means off under `.security/security-fix.json:95`.
- The static seven-slot rotation is only policy data: `.security/security-fix.json:117`.
- GitHub returned 404 for `rhanka/sentropic-seat-custody`. This establishes **absent or inaccessible to this reader**, not proof that an operational custody service exists.

**Seat-driven AI mode and enrollment**

[PR #681, “CI seat import (L1)”](https://github.com/rhanka/sentropic/pull/681), remains **OPEN and draft**, at head `5991bfc8c459379c871803acf67d71902524ba72`. Its reported checks include failures in three AI API shards, E2E groups A/C/D and `ci-gate`. The [P0a handoff:4](/home/antoinefa/src/sentropic/.tmp/daily-sec-fix/p0a-l1/acceptance.md:4) explicitly withholds L1 acceptance. Its `:10` and `:79` identify separate preserved local Lot 8 work that must be reconciled without discarding it.

The old retirement prerequisite is stale as a description of current main. PR #686 remains open, but current `api/src/config/env.ts:37` defaults to `gpt-5.4-nano`, and `api/tests/utils/test-helpers.ts:57` defaults CI to `mistral-small-2603`. Revalidate the actual operation/model inventory and accepted migration evidence; neither the old failure nor an unrelated default change proves today’s seat route qualified.

On main, `packages/llm-mesh/src/enrollment/seat-bundle.ts:3` is explicitly the **L0a synthetic contract**. It performs no home, keyring, network or provider access. It supplies:

- Five CLI identities and mappings: agy → `cloud-code`; codex → `codex`; vibe → `mistral-vibe`; muse → `muse`; claude → `claude-code` (`:13`, `:22`).
- Separate seat, account binding, owner, refresh-family and lifecycle identities (`:65`, `:79`, `:85`).
- Custodian-only refresh authority and renewable material (`:298`).
- Credential-free receipts (`:400`).

It does not supply a scheduler, prove live enrollment, authorize paid fallback, or establish operational multi-account rotation. Main’s `spec/SPEC_EVOL_CI_SEATS.md:3` likewise describes L0a only.

**Approval ledger**

| Design/version | Established status |
|---|---|
| `.tmp/ci-seats/ci-seats-proposal-v1.md` | Corrections required by its Opus challenge. |
| `.tmp/ci-seats/ci-seats-proposal-v2.md` | **APPROVED design direction**: Opus `VALIDÉ`, zero blocking/major findings; six minor dispositions remain implementation inputs. [Validation:7](/home/antoinefa/src/sentropic/.tmp/ci-seats/ci-seats-validation-opus-v2.md:7). |
| Earlier HTML owner dossiers | Their challenges require corrections. HTML v2 is not approved merely because proposal v2 was validated. [Dossier challenge:13](/home/antoinefa/src/sentropic/.tmp/ci-seats/dossier-challenge-opus-r2.md:13). No independent v3 approval receipt was located. |
| Custody `spec-v10.md` | **APPROVED for L1 design**, with a non-blocking gateway/mesh compatibility correction. [Opus r6:15](/home/antoinefa/src/sentropic/.tmp/ci-seats-v4/challenge-opus-r6.md:15), `:52`. Earlier correction rounds are superseded. |
| AI seat-mode addenda v1–v4 | **Not approved** in their respective Opus challenges. |
| AI seat-mode v5 | **Conditional design GO**, with reservations R1–R4. [Challenge:1](/home/antoinefa/src/sentropic/.tmp/ci-seats-v4/challenge-opus-ci-ai-seat-v5.md:1). |
| AI seat-mode v6 | Applies those reservations to v5; **no fresh independent approval or live qualification established**. It explicitly retains `selection-failed` consensus status. [v6:7](/home/antoinefa/src/sentropic/.tmp/ci-seats-v4/ci-ai-seat-mode-addendum-v6.md:7), [:864](/home/antoinefa/src/sentropic/.tmp/ci-seats-v4/ci-ai-seat-mode-addendum-v6.md:864). |
| Daily-security specification r1/r2 | `CHANGES` in their reviews. |
| Daily-security specification r3 | **APPROVED**, zero P1/P2, five P3 refinements. [Review r3:92](/home/antoinefa/src/sentropic/.tmp/daily-sec-fix/review-opus-r3.md:92). |
| Current daily-security specification r4 | Binding owner amendment to approved r3: public operation and expanded bounded automatic-merge classes. **No new independent approval claimed.** [Specification:364](/home/antoinefa/src/sentropic/.tmp/daily-sec-fix/spec-plan.md:364), [:399](/home/antoinefa/src/sentropic/.tmp/daily-sec-fix/spec-plan.md:399). |
| This activation plan | **Proposed; design review required** for arbitrary account multiplicity, zero-paid fallback, current model mappings and the report-only AI review milestone. |

The earlier AI-CI design authorized bounded API credit. That historical authorization is not carried into this activation path: the current owner rule requires exhaustion to stop or rotate to another eligible existing seat, without payment.

## 2. The owner’s enrolled accounts

**The complete named roster could not be established within the credential-read prohibition.** The available metadata proves the following names; it does not prove current authentication, remaining quota or unattended-use qualification.

| Name | Provider |
|---|---|
| `claude-local` | Anthropic / `claude-code` |
| `claude-max` | Anthropic / `claude-code` |
| `Mistral Vibe (acct_mistral_vibe_mu)` | Mistral / `mistral-vibe` |

Sources: [accounts.json:4](/home/antoinefa/.sentropic/accounts.json:4), [:10](/home/antoinefa/.sentropic/accounts.json:10), and [llm-mesh.json:44](/home/antoinefa/.sentropic/llm-mesh.json:44). These are separate registry entries; their underlying quota relationships have not been verified.

A dated enrollment receipt also records the name `Claude (acct_claude_peDZJxgCtgTx67vKtcbw9w)`, provider `claude-code`, at [live-enroll-receipt.json:5](/home/antoinefa/.sentropic/llm-mesh-live-keyring/live-enroll-receipt.json:5). It must be reconciled with the current roster before counting it as another active account.

The CLI-directory inspection found these additional **filename-derived profile labels**, not independently verified account identities:

| Name | Provider |
|---|---|
| `compte1` | Meta / Muse |
| `compte2` | Meta / Muse |
| `compte3-fabien` | Meta / Muse |
| `muse2` | Meta / Muse |
| `avant-trash-20261030` backup | OpenAI / Codex |

The Muse labels come from backup filenames under `~/.config/muse`; `muse2` comes from the separate `~/.config-muse2/muse` directory. The active and backup authentication files were not opened. **`~/.config/muse` was not modified.** The Codex label comes from `~/.codex/auth.json.bak-avant-trash-20261030`; a backup does not prove a second distinct account.

For Vibe, a metadata-only calculation over `~/.vibe/whoami_cache.json` found **two cached entries with two distinct customer identities**. Their names are absent from that cache. Its contents do not establish that both remain usable or map either one to the named registry entry.

The Vibe configuration’s `mistral`, `llamacpp`, `glm-5.3` and `mistral-large-4` entries are provider/model configuration, not separate account enrollments: `~/.vibe/config.toml:48`, `:108`, `:122`.

Consequently:

- Multiple Vibe identities are evidenced, but their complete names remain missing.
- Additional distinct Codex accounts are requested by the owner but cannot be named or counted from the inspected non-secret metadata.
- Muse backups cannot be counted as independent quota pools without identity reconciliation.
- The old seven aliases in the daily policy are not a current account inventory.

The encrypted mesh registry was not decrypted. Its normal `listAccounts` path invokes restoration, which reads credential envelopes and may write owner/migration state: `packages/llm-mesh/src/service/local-account-transport-service.ts:586`, `:1271`, `:1298`, `:1319`. A names-and-provider-only export from the trusted enrollment owner is therefore an outstanding input. **“All accounts activated” cannot be an acceptance claim until that roster is complete.**

**Required duplicate-account behavior**

- Keep every distinct enrolled account as an independently addressable seat. Do not collapse entries merely because their provider or display name matches.
- Reconcile aliases of the same underlying account. They share provider quotas, refresh-family locks and reservations; duplicate registration must not multiply capacity.
- Replace the fixed seven-slot array with a reviewed roster-derived rotation. Persist the cursor across runs, repositories, restarts and quota resets.
- Check eligibility before each dispatch: exact model, account binding, current generation, billing clearance, available reservation and readable quota above the inherited 20% reserve.
- Try each eligible account at most once per admission cycle. On quota exhaustion, move to another qualified account. When none is eligible, persist `waiting-seat` and release the runner.
- Apply the owner’s rule: **« Y a aucun paiement a faire si quota épuisé c épuisé »**. No paid API fallback, prepaid-credit consumption, automatic top-up, seat overage or paid runner overage.
- Preserve existing fleet and shared limits until a reviewed policy amendment changes them: four security inference units/day, two per slot/day, shared CLI caps and protected maintenance allocations. Adding accounts does not automatically raise those ceilings.
- Isolate each account’s native configuration, access projection, temporary files and process environment. Never overwrite the owner’s active Codex/Muse/Vibe profile or copy an entire authentication home.
- Keep one refresh authority per refresh family. Consumers cannot refresh, borrow another account’s credentials or reset lineage.
- Pin a conversation/test case to its admitted route. Do not continue provider conversation state under another account after exhaustion.
- For model-authored fixes, the reviewer must use a different exact model from every contributing author. Two accounts running the same model do not provide independent review.
- Include all enrolled accounts in the roster and rotation policy. This does not require an inference call from every account every day.

## 3. The shortest safe activation path

The minimum useful sequence is **qualified daily discovery → daily seat review → separately gated automatic fixes**. Daily discovery does not depend on #681; seat-driven reviews do.

Model assignments follow [COMMON-RULES.md:22](/home/antoinefa/src/sentropic/.tmp/packets/COMMON-RULES.md:22): Astra MAX for plan authorship; **Muse Wonder max or Opus 5.5 max for this plan’s independent design reviews**; Sol 6.1 xhigh for implementation, with an independent permitted code reviewer such as mistral-large-4 xhigh. Mistral-large-4 must not review design.

No CI is run by this planning task. For implementation, validate locally first, then run CI once on each final review-ready head; rerun only for a demonstrated transient. Preserve required AI coverage: quota exhaustion leaves it incomplete, never green. Incremental authorized API expenditure and paid overage are zero; actual runner, storage and quota usage must be measured rather than assumed free.

1. **Wave 0 — Freeze the activation amendment and complete the named roster.**

   **Inputs:** This audit, approved custody v10, AI-CI v6, daily r3/r4, current main, #681’s published and preserved local work, and the missing names-only roster.

   **Outputs:** One reviewed amendment covering all-account rotation, zero-paid routing, current operation/model mappings, report-only AI review, custody location and immutable acceptance inputs. Assign the conductor as the single Track writer for the request, lots and decisions; this read-only author performs no Track write.

   **Acceptance:** Every account has an evidenced name/provider mapping or an explicit unresolved record; aliases cannot increase quotas. Resolve the stale #686 assumptions against current code. Design approval binds the exact document and dispositions.

   **Approval/model:** Existing foundations approved; these changes **need design review**. Astra MAX author; Muse Wonder max or Opus 5.5 max reviewer.

   **CI cost:** No workflow run for the planning artifact; review consumes only admitted existing-seat quota.

2. **Wave 1 — Complete scanner, verifier and trust admission. Depends on Lot 1.**

   **Inputs:** #840/#849/#850/#852 evidence, frozen policies, unresolved scanner findings and independent-review gap.

   **Outputs:** An admissible patched scanner digest, independently admitted verifier/content, fresh authenticated trust material and DB ingestion receipts. Preserve the stated DB guarantee; do not claim an unestablished publisher signature.

   **Acceptance:** Extend `toolchain-contract.test.mjs`; retain self-scans, positive offline verification, malformed/tampered material refusal, freshness boundaries and real native negative controls. Publish independent reviews of the exact candidate. A still-vulnerable candidate remains blocked.

   **Approval/model:** Existing qualification design retained; changed trust guarantees require design review. Sol 6.1 xhigh implementation; independent code/content review, with Muse Wonder max or Opus 5.5 max for design changes.

   **CI cost:** Targeted local tests, one final-head CI; bounded acquisition, storage and scanner execution, with no inference in scanning.

3. **Wave 1 — Resume #681 and qualify the seat control boundary. Depends on Lot 1; independent of scanner work.**

   **Inputs:** Draft #681, its failed full-CI result, preserved Lot 8 work, L0a contract and the accepted zero-paid amendment.

   **Outputs:** Reconciled L1 import/delivery code, compatible mesh/gateway artifacts with one mesh copy, enforced external-refresh policy, trusted broker isolation and complete CI result accounting. Reuse the existing custody design; do not create a second credential store or private findings repository.

   **Acceptance:** Existing/proposed `cli-seat-import.test.ts`, `external-seat-authority.test.ts`, `seat-projection-delivery.test.ts`, `mesh-release-invariants.test.ts`, API receiver tests and broker isolation tests. Prove expiry/401 causes no refresh or billed-key fallback. Re-pin head/base/tree and artifact identities. Preserve reviewed pre-merge control promotion so qualification does not depend circularly on merging first.

   **Approval/model:** L1 foundation **approved**; v6 amendments and current routing **need design review**. Sol 6.1 xhigh; independent code review by mistral-large-4 xhigh or another permitted distinct model.

   **CI cost:** Local synthetic gates first; one complete final-head CI. Intentional live AI cases consume qualified seat quota only and wait when unavailable.

4. **Wave 2 — Qualify ast-grep, IaC and independent completeness inventories. Depends on Lot 2.**

   **Inputs:** Admitted scanner/toolbox candidates, discovered source roots, locks, image surfaces and #846’s isolated catalog coverage gap.

   **Outputs:** Native Rust ast-grep, immutable reviewed toolbox digest, frozen local rules, explicit severity mapping, complete declared IaC adaptation and independently established expected inventories. Cover discovered package/app/script roots, not only API/UI.

   **Acceptance:** Proposed `sast-contract.test.mjs` and IaC fixtures; positive and negative cases for required rules and every declared document surface. Reject omitted components, unsupported lock layouts and zero-configuration “success.” Qualify isolated tool/consumer catalogs or retain explicit blocking coverage gaps.

   **Approval/model:** Ast-grep requirement **approved**; concrete rules, coverage mapping and any analyzer changes **need design review**. Sol 6.1 xhigh; Muse Wonder max or Opus 5.5 max for rule/coverage design; separate code review.

   **CI cost:** Local fixture scans and one final-head CI; admitted toolbox image construction and artifact storage. No model calls in deterministic scanner tests.

5. **Wave 2 — Qualify remote targets, S3 receipt custody and isolated rebuild. Depends on Lot 2.**

   **Inputs:** A frozen main SHA, its three image producers, registry provenance and reviewed custody contract.

   **Outputs:** Matching immutable API/toolbox/UI targets; target-scoped pull access outside scanner tools; validated target/DB/report receipts; isolated rebuild capability. An archive route is acceptable only after separate custody/completeness admission.

   **Acceptance:** Extend `trivy.test.mjs` and custody fixtures for wrong SHA/platform/configuration, missing producer evidence, forged receipts, partial uploads and broad credential exposure. Retain successful remote-path isolation evidence and an actual isolated rebuild. Scanner containers receive no operator registry configuration or shared daemon.

   **Approval/model:** Existing target/isolation requirements retained; concrete custody and builder design **need review**. Sol 6.1 xhigh; Muse Wonder max or Opus 5.5 max for design, independent code review thereafter.

   **CI cost:** One final-head CI plus bounded image/DB transfer and retained evidence. Measure storage and rebuild consumption; unknown entitlement blocks activation.

6. **Wave 2 — Qualify every enrolled account and durable rotation. Depends on Lots 1 and 3.**

   **Inputs:** Complete named roster, accepted duplicate-account policy, exact model mappings and an accessible qualified custody boundary.

   **Outputs:** Per-account qualification records, isolated profiles/projections, shared quota-family accounting, persistent rotation and explicit disabled reasons. No changes to the owner’s active CLI directories.

   **Acceptance:** Extend `security-admission.test.ts`, `security-quiescence.test.ts` and custody tests. Include two Codex accounts, two Vibe accounts, same-account aliases, account restart, generation replacement, quota exhaustion, unreadable quota, concurrent reservations and cancellation. Prove that exhausting every account produces zero paid requests. Real qualification covers every roster entry before claiming all-account readiness.

   **Approval/model:** Five-CLI envelope **approved**; arbitrary account multiplicity and revised rotation **need design review**. Sol 6.1 xhigh implementation; independent code review; Muse Wonder max or Opus 5.5 max design acceptance.

   **CI cost:** Synthetic CI once on the final head; live account proofs consume reserved existing-seat quota. No inference-based quota polling.

7. **Wave 3 — Integrate the complete scan and prove performance/recovery. Depends on Lots 4 and 5.**

   **Inputs:** Admitted engines, rules, inventories, targets and custody receipts.

   **Outputs:** `scan.mjs` invokes the qualified npm, Trivy and ast-grep paths; schema and inventory admission follow verified policy instead of hardcoded S1/S2 placeholders. Produce a coherent complete report with immutable source, rules and DB identities.

   **Acceptance:** Run the five existing daily suites and parser suite, adding end-to-end coverage fixtures. Missing/error/partial surfaces must never produce `complete-clean`. Demonstrate comparable complete CI ≤600 s without dropping required work. Establish an admitted laboratory runtime baseline, exercise failed-upgrade recovery to it, and preserve trust high-water state and reservations during rollback.

   **Approval/model:** Existing scan/performance/recovery requirements retained; activation-state/schema changes reviewed under Lot 1. Sol 6.1 xhigh; independent code review.

   **CI cost:** One final-head CI carrying the required performance evidence; cold/warm and recovery trials are declared qualification work, not repeated CI attempts to select a favorable result.

8. **Wave 4 — Activate public daily discovery: M1. Depends on Lot 7.**

   **Inputs:** Complete admitted scanner and reviewed public workflow/collector contract.

   **Outputs:** Public `.github/workflows/security-daily.yml` with schedule and manual dispatch, immutable main selection, validated public reports and durable unresolved backlog. Implement the named kill-switch reader and verified off/cancellation commands. Keep scan, collector and control permissions separate.

   **Acceptance:** Proposed `workflow-contract.test.mjs`, `findings.test.mjs`, `state.test.mjs` and cancellation tests. Prove unchanged-main scanning, collector-only writes, secret canaries, upload failure, stale/missed schedule detection, deduplication and off/unreadable refusal. Confirm the workflow cannot publish packages, deploy or merge.

   **Approval/model:** Public-operation direction is a binding owner amendment; concrete implementation requires the Lot 1 design approval. Sol 6.1 xhigh; independent code review.

   **CI cost:** One final-head CI, then one full scan per admitted day. Budget the monthly daily runs, explicitly bounded manual/retry allowance and retention against actual public-runner/storage entitlement; paid overage stays disabled.

   **This is the first point a real daily run can start.** It scans pinned main with qualified SCA, all three image surfaces, SAST and IaC; publishes all-severity findings, coverage, exception expiry and grouped repair candidates. It performs no AI inference or code change. It does not require #681.

9. **Wave 5 — Activate scheduled account-driven cybersecurity review. Depends on Lots 6 and 8.**

   **Inputs:** Validated daily report, immutable evidence bundle, qualified account roster and trusted review-purpose admission.

   **Outputs:** A bounded daily AI review of changed findings and evidence, with structured prioritization, uncertainty and account/model provenance. Reuse the shared security allowance. Publish sanitized results through the separate collector.

   **Acceptance:** Proposed `daily-review.test.mjs` plus admission/isolation tests: all distinct accounts remain represented; duplicate-provider accounts rotate; same-account aliases share quota; exhausted/busy/unqualified accounts are skipped with reasons; all-exhausted means `waiting-seat`, zero payment and released runner. Test hostile findings, prompt injection, forged evidence and provider output carrying synthetic secrets. Unchanged evidence must not trigger unnecessary inference.

   **Approval/model:** **New report-only integration needs design review** by Muse Wonder max or Opus 5.5 max. Sol 6.1 xhigh implements it. Runtime reviewers rotate among qualified models allowed for code/security review under the owner rule.

   **CI cost:** One final-head CI; daily inference uses existing seat quota only. No per-account daily smoke or conversational heartbeat is added.

   **This is the first milestone satisfying the requested daily reviews with all enrolled accounts represented.** Readiness must distinguish qualified participants from named accounts still blocked on evidence.

10. **Wave 6 — Add the already-authorized bounded fix/merge stage, then expand repository by repository. Depends on Lot 9.**

    **Inputs:** Qualified review service, fixed repair classes, publisher/merger separation and current repository protections.

    **Outputs:** Real bounded fix PRs, other-model review, green required CI and guarded exact-head automatic merge; main verification retires debt. Preserve two new PRs/day fleet-wide, six open PRs, separate reconciliation and public evidence. Roll out other repositories only after their own coverage, quota, release-effect and cost acceptance.

    **Acceptance:** Existing planned `repair-policy`, `isolation`, `publish`, `review`, `readiness`, `merge`, `limits` and cancellation tests. Include base/head drift, partial AI CI, same-model review, forged receipts, kill-switch races and downstream deployment effects. Register removal requires two complete absence scans plus fresh pre-merge proof. Do not broaden scope at runtime.

    **Approval/model:** Approved r3 foundations plus binding r4 amendment; concrete own-code paths and unresolved amendments need design review. Sol 6.1 xhigh implementation, independent permitted code reviewer. No renewed per-PR owner approval is introduced within the authorized class.

    **CI cost:** One final-head implementation CI; subsequently required CI per eligible repair PR, within the shared cap and zero-paid policy.

    This stage is not a prerequisite for daily review. The optional advisory relay likewise stays outside the shortest activation path.

Dependency waves permit independent preparation, but execution must respect the shared limit of two build/test lanes, one Docker build under the existing lock, no concurrent heavy suites, isolated test environments and `ENV=…` last.

## 4. Owner choices

Les décisions déjà prises restent acquises : tous les comptes enregistrés doivent figurer dans la rotation, aucun paiement à l’épuisement des quotas, rapports publics, démarrage sur Sentropic puis dépôt par dépôt, et fusion automatique dans le périmètre déjà autorisé après les contrôles requis.

| Choix | Options | Recommandation | Défaut |
|---|---|---|---|
| **Quand démarrer ?** | **A.** Démarrer les scans qualifiés, puis ajouter les revues IA dès que les comptes sont prêts. **B.** Attendre que tous les comptes soient qualifiés avant le premier scan quotidien. | **A** : les premiers rapports ne dépendent pas des comptes IA. | **A**, uniquement après validation des contrôles du scan. |
| **Comment répartir les revues ?** | **A.** Alterner les fournisseurs, puis les comptes de chaque fournisseur. **B.** Donner un tour égal à chaque compte, ce qui favorise les fournisseurs où plusieurs comptes existent. | **A** : utiliser tous les comptes en conservant une diversité de modèles. | **A**, à formaliser dans la revue de conception. |
| **À quelle heure lancer le scan ?** | **A.** 06 h 15 UTC. **B.** 11 h 15 UTC. | **A** comme horaire fixe initial, à confirmer avec la capacité réelle des runners. | **A** après qualification ; sinon le service reste désactivé. |

La liste complète des noms de comptes et la disponibilité du stockage sécurisé sont des informations manquantes à vérifier, pas des autorisations de lire les secrets. Aucune option ne permet de contourner un quota, de payer un dépassement ou de déclarer une couverture incomplète comme réussie.

## 5. Risks

| Risk | Consequence | Required control |
|---|---|---|
| **Secret exposure in CI** | Public logs, artifacts, candidate scripts or model tool children could expose provider, registry or GitHub credentials. | Separate credential-bearing control from scans/candidate execution; inject only account-scoped capabilities through qualified interfaces; no auth-home mounts, transcripts, environment dumps or credential artifacts. Test hostile repository content and synthetic secret leakage. Quarantine invalid output. |
| **Seat terms and entitlement** | An enrolled account may not support the intended unattended/native/mesh route or public-repository use. | Preserve existing provider-specific risk decisions and qualification requirements. Record the exact client, entitlement and route; do not infer eligibility from successful login or private execution. The Codex documented boundary remains explicit in [spec-v10:309](/home/antoinefa/src/sentropic/.tmp/ci-seats-v4/spec-v10.md:309). Unsupported routes remain visibly unqualified. |
| **Cost and quota** | Same-provider duplicates can share quotas; inherited API fallback or pay-as-you-go can create charges. | Zero-spend billing receipts, no credit fallback/top-up, shared account-family reservations, preserved reserve and global caps. Unknown/exhausted capacity means wait. Public runner status does not prove every storage or runner class is unmetered. |
| **Noise and false positives** | Repeated findings, stale exceptions and incomplete reports can create duplicate work or misleading “clean” results. | Stable finding/repair keys, unchanged-result deduplication, all-severity visibility, independent completeness inventories, explicit coverage gaps and bounded review. Exceptions remain debt; reconciliation requires repeated complete evidence. |
| **Runner load** | DB transfers, three image surfaces, rebuilds and full required CI can overload shared capacity or breach the 600-second gate. | Prefer qualified immutable remote targets, bound concurrency and resources, retain digest caches without reusing stale verdicts, measure queues separately, and release runners while waiting for seats. Preserve the shared build lock and lane limits. |
