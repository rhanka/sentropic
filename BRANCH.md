# Feature: Comments and annotations documentary promotion

## Objective
- [x] Prepare the SPEC, English evidence extracts and aligned plans required by SPEC §1 for documentary promotion.
- [ ] Commit the reviewed promotion series; create the model branch from its LAST commit only in the subsequent implementation task.

## Scope / Guardrails
- [x] Preparation task: files only; no Git command, Make, build, runtime test, service, subagent, external message, Track write or implementation during preparation or P-1–P-5 recording. The commit series below belongs to the subsequent commit task.
- [x] Supplied baseline: spec/comments-annotations-port at dc95f7e4f88048e9671002827537cde4cb8149b7; branch and ancestry are not rechecked in this task.
- [x] Worktree: tmp/worktrees/comments-annotations-port; no new worktree, environment, port or migration needed.
- [x] Confirmed source SPEC: c6d7a548d25746243b3904a20adea2d1b96360b3042445ba020a8204479ed967; CONF3 reports zero blocking, zero major and seven minor findings.
- [x] Promotion files are English; AUTH-M, TREAT2 answers and the two authorized register statements remain verbatim French with source digests.
- [x] Copy no other private host content, personal identifier or private source path; preserve frozen inputs and original local plans.
- [x] Future commands use Make with ENV last; tests use test-* or e2e-*, never dev; no runtime checks apply to this documentary change.
- [x] Subsequent commit procedure: update the lot checkboxes, stage the lot's fully added files by name in one call (`rtk git add -- <named-files>`, never `.` or `-A`), run `rtk make scope-check ENV=comments-annotations-port` and inspect staged counts, then issue `rtk make commit MSG="docs: ..." ENV=comments-annotations-port` in a separate call. C06/C08 use the fragment-only index method below, with only BRANCH.md in their git-add call.
- [x] Never use `git commit`; commit messages, bodies and trailers contain no AI attribution, `Co-Authored-By`, `Claude-Session` or `Generated with` line.
- [x] CONF4 records bounded confirmation of the resulting SPEC/plan/evidence bytes: 0 blocking, 0 major, 5 minor P-1–P-5, treated only within the closed recording delta below; CONF3 remains acceptance of its own pinned source.
- [ ] Keep the documentary base unmerged before M1; later evidence/code merge follows P4-S and the owner's merge gate, with real delivery separately gated by OWNER-D2.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (document scope)**:
  - [x] `spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md`
  - [x] `docs/comments-annotations/evidence/**`
  - [x] `docs/comments-annotations/plan/**`
  - [x] `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `.github/**`
  - [x] `.gitignore`
  - [x] `.track/**`
  - [x] `.h2a/inputs/**`, `.h2a/reviews/**`, `.h2a/review-snapshots/**`, `.h2a/interface/**`, `.h2a/plan/**`
  - [x] `packages/**`, `api/**`, `ui/**`, `e2e/**`, `rules/**`, `plan/**`, `PLAN.md`
- [x] **Conditional Paths (only under the declared exception)**:
  - [x] `.h2a/SPEC_REVISION_LOG.md` — append only under BRCA-EX2; ignored local provenance, never staged.
- [x] **Exception process**:
  - [x] Declare the precise rationale, impact and rollback in Feedback Loop before using an exception; no other scope or commit-size waiver is granted.

## Feedback Loop
- [x] C0FIX-§18.2 — align step-1 docs with frozen L3a v4.1 §18.2 (C0 Opus M6): owner-closed Lot 1 freeze with carried reserves replaces M1-authoring language; independent shared storage port (§17.4 K1) replaces live-storage/port.ts proposals; selected qualified PG profiles (§17.5) replace universal L3b-S/live-generation gates; digest-pinned packaged oracle replaces ./conformance export claims. Rationale: promoted SPEC/plans contradicted the frozen spec and the C0 compatibility doc. Impact: docs only, 4 files (SPEC + 3 plans). Rollback: revert the alignment commits on this branch before re-merge.
- [x] BRCA-EX1 — authorized choice in the promotion brief: allow one indivisible SPEC-addition commit above 150 changed lines, plus its required BRANCH.md checkbox update. Rationale: preserve the complete reviewed specification and its byte identity instead of intermediate incomplete contracts. Impact: documentation only, approximately 531 SPEC lines; at most two files. Rollback: remove the unmerged promoted SPEC and invalidate its receipt before any model branch starts; preserve the frozen source.
- [x] BRCA-EX2 — promotion and reserves briefs authorize appending the local revision log. Rationale: trace n-3/n-4/n-5 and P-1–P-5 without rewriting historical treatments. Impact: ignored provenance only, with English tracked extracts. Rollback: remove only the relevant appended section; preserve the original 7f713c5a861f79c75d067398d81dc0db1c26c38ceba1ce338b271897bfbe12fa prefix and, for the reserves append, the incoming 63,201-byte prefix with SHA-256 38e0e63ade1d9e1ea5971e5381d62a16b9241e714082e8a4ce2ca207ba788b43.
- [ ] CONF3 n-1/n-2 — comments/integration maintainers, model Lot 0: working breaking-minor version above the registry version for enforce-package-bump; preserve the LAST promotion commit as ancestor, with no rewrite of its documentary ancestry through P4-S.
- [ ] CONF3 n-6 — respective host integration maintainers, before P4-S/P6: qualify host-local reopening; Sentropic's restore rehearsal cannot gate the receiver's P6.
- [ ] CONF3 n-7 — delivery maintainer, before P5/M4: qualify the actual branch workflow trigger without main merge; retain the authorized exact direct-copy path.
- [x] P0 promotion delta — CONF4 by declared Claude Opus 5.5, max requested but unverifiable, is recorded in evidence/convergence.md; review SHA-256 0a4fa303fe6658258735dae1fb2cdcf2e57e23534dceccb411c1a6f225aad491. Its closed list of changes permitted without new confirmation is exclusively:
  - [x] (a) evidence/convergence.md: record CONF4's status, verbatim English block, verdict/counts, review digest, inspected hashes, identity and limits in Promotion-delta review; update its status/heading and P-3 precedence statement consistently.
  - [x] (b) evidence/index.md: refresh affected digests and source aliases for CONF4 and author metadata; retain the pre-recording identities in the receipt.
  - [x] (c) evidence/author-metadata.md: P-2 AUTHOR-PROMO declaration and this reserves run's own header with explicitly bounded source digests; no routing attestation.
  - [x] (d) evidence/index.md: P-3 receipt precedence and P-4 durable BRCA-EX1/EX2/C01–C11 summary, with the BRANCH.md link qualified to the anchor commit.
  - [x] (e) BRANCH.md: P-5 preparation/commit wording, noninteractive fragment staging, hash gates, recording checkboxes and corresponding line-count estimates.
  - [x] (f) Optional short English CONF4 extract in evidence/review-confirmations.md before C05; not used in this reserves pass. The local append-only trace is separately authorized under BRCA-EX2. Any change outside this list requires bounded confirmation of that additional delta.
- [ ] Interface maintainer supplies E2/TR2 attribution/backup errata and obtains acknowledgement with the P1 freeze receipt before host preparation relies on E2.

## AI Flaky tests
- [x] Not applicable: documentary inspection only; no test, provider or CI success is claimed.

## Orchestration Mode (AI-selected)
- [x] Mono-branch documentary preparation by one author; a subsequent agent performs the reviewed commit series. No delegation or branch integration now.

## UAT Management (in orchestration context)
- [x] Document inspection covers links, source digests, exact quotations, reserve treatment and template structure; runtime web/Chrome/VSCode UAT is outside this branch.
- [ ] Subsequent committer verifies actual branch/ancestry with harness, runs scope-check before each commit and checks staged changed-line/file counts; this task ran none of those commands.
- [x] Before C11, run `rtk sha256sum spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md docs/comments-annotations/plan/*.md docs/comments-annotations/evidence/*.md`; compare the SPEC and three plans to the four pinned hashes in evidence/convergence.md, refreshed extracts to evidence/index.md, and all six untouched extracts to CONF4's pre-recording hashes. Any unlisted delta requires confirmation before recording.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Prepared source inventory and scope**
  - [x] Read SPEC §1, CONF3 and the aligned plans; preserve source snapshots and record declaration/reading limits.
  - [x] Select BRCA-EX1 for the SPEC only; use ordered plan fragments for other files exceeding 150 lines.
- [x] **Lot 1 / C01 — Declare promotion scope**
  - [x] Files: BRANCH.md; message: `docs: scope comments annotation promotion`; approximately 105 added lines.
  - [x] Gate: use the supplied untracked-file baseline only after the committer verifies it; no implementation authority is inferred.
- [x] **Lot 2 / C02 — Promote the indivisible SPEC**
  - [x] Files: spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md and BRANCH.md; message: `docs: promote comments annotation specification`; approximately 537 changed lines under BRCA-EX1.
  - [x] Gate: complete SPEC, exact quotations, restored n-5 clauses and tracked authority links match the reviewed promotion bytes.
- [x] **Lot 3 / C03 — Preserve owner authority and author declarations**
  - [x] Files: evidence/owner-decisions.md, evidence/author-metadata.md and BRANCH.md; message: `docs: preserve comments owner authority`; approximately 105 changed lines.
  - [x] Gate: AUTH-M and all TREAT2 answers verbatim; register quotations alone copied from private provenance; AUTHOR-C6/2E/PROMO whole logs and AUTHOR-RESERVES' fixed header source-hashed with their declaration limits.
- [x] **Lot 4 / C04 — Promote historical interface and review evidence**
  - [x] Files: evidence/interface-errata.md, evidence/review-history.md and BRANCH.md; message: `docs: preserve comments interface review evidence`; approximately 130 changed lines.
  - [x] Gate: S-R01–20, SO/CROSS treatments and superseded attribution/backup clauses remain readable without ignored sources.
- [x] **Lot 5 / C05 — Promote treatment and confirmation evidence**
  - [x] Files: evidence/review-c6.md, evidence/review-confirmations.md and BRANCH.md; message: `docs: preserve comments confirmation evidence`; approximately 100 changed lines.
  - [x] Gate: every C6/CONF2 finding has a reasoned disposition; CONF3's exact source verdict and all seven reserve gates are identified.
- [x] **Lot 6 / C06 — Add plan authority, topology and requirements**
  - [x] Files: plan/PLAN_COMMENTS_ANNOTATIONS.md lines 1–82, ending before Implementation lots and file-level verification, plus BRANCH.md; message: `docs: add comments model delivery topology`; approximately 88 changed lines.
  - [x] Gate: noninteractively obtain a blob with `rtk head -n 82 docs/comments-annotations/plan/PLAN_COMMENTS_ANNOTATIONS.md | rtk git hash-object -w --stdin`, then substitute its printed ID in `rtk git update-index --add --cacheinfo 100644 <blob-id> docs/comments-annotations/plan/PLAN_COMMENTS_ANNOTATIONS.md`; stage only the updated checklist with `rtk git add -- BRANCH.md`. Keep full working bytes untouched; no `git add -p` or full-plan add before C07, and no intermediate fragment is an implementation base.
- [x] **Lot 7 / C07 — Complete the plan and add its handoff**
  - [x] Files: plan/PLAN_COMMENTS_ANNOTATIONS.md lines 83–163, plan/PLAN_HANDOFF.md and BRANCH.md; message: `docs: complete comments delivery plan and handoff`; approximately 119 changed lines.
  - [x] Gate: add the full working plan, handoff and BRANCH.md by name in one call, then commit separately; after C07, `rtk proxy git show HEAD:docs/comments-annotations/plan/PLAN_COMMENTS_ANNOTATIONS.md | rtk sha256sum` hashes raw committed bytes and must yield a4bff48c0206a525eed8b54a7520cadfe7fe885fdf4dbb18ba0c39c51ed9969a. Candidate, integration, UI and actual delivery gates stay distinct.
- [x] **Lot 8 / C08 — Add model scope and Lot-0 obligations**
  - [x] Files: plan/BRANCH_P1_TEMPLATE.md lines 1–126, through Lot 0, plus BRANCH.md; message: `docs: define comments model branch entry gates`; approximately 132 changed lines.
  - [x] Gate: noninteractively obtain a blob with `rtk head -n 126 docs/comments-annotations/plan/BRANCH_P1_TEMPLATE.md | rtk git hash-object -w --stdin`, then substitute its printed ID in `rtk git update-index --add --cacheinfo 100644 <blob-id> docs/comments-annotations/plan/BRANCH_P1_TEMPLATE.md`; stage only BRANCH.md with `rtk git add -- BRANCH.md`. Keep full working bytes untouched; no interactive or full-template add before C09. Working version, draft PR CI, readable evidence and fixed ancestry remain entry obligations.
- [x] **Lot 9 / C09 — Complete the model template**
  - [x] Files: plan/BRANCH_P1_TEMPLATE.md lines 127–183 and BRANCH.md; message: `docs: complete comments model qualification lots`; approximately 63 changed lines.
  - [x] Gate: add the full working template and BRANCH.md by name in one call, then commit separately; after C09, `rtk proxy git show HEAD:docs/comments-annotations/plan/BRANCH_P1_TEMPLATE.md | rtk sha256sum` hashes raw committed bytes and must yield c7a21ddd5d63ed60a89537dcd9694722977be6d84871068b6c61a814d6e558e4. The complete checkbox-only template retains file-level checks and n-6/n-7 roles/gates.
- [x] **Lot 10 / C10 — Record promotion treatment and convergence**
  - [x] Files: evidence/treatment-promotion.md, evidence/convergence.md and BRANCH.md; message: `docs: record comments promotion treatment and convergence`; approximately 124 changed lines.
  - [x] Gate: CONF4's actual verdict/block and P-1–P-5 dispositions are recorded; the receipt supersedes historical pending-confirmation mentions without changing SPEC/plan bytes. Only the closed recording delta is permitted without further confirmation.
- [x] **Lot 11 / C11 — Final evidence index and documentary validation**
  - [x] Files: evidence/index.md and BRANCH.md, plus bounded receipt corrections only if counted below the limit; message: `docs: anchor comments documentary promotion`; under 140 changed lines.
  - [x] Gate: all links and digests resolve, reviewed SPEC/plans are complete, actual delta receipt is present; ordinary commits remain below 150 changed lines and at most 15 files including checkbox updates.
  - [ ] Record the LAST series commit SHA as the model-branch anchor in the subsequent model BRANCH.md, with pinned main ancestor dc95f7e4f88048e9671002827537cde4cb8149b7 after ancestry verification; do not invent or self-embed the future SHA.
  - [x] Any extra correction outside the closed recording list requires affected-delta confirmation and a separately counted commit before the final index commit; no squash, main merge or implicit delivery approval.
- [x] Paths abbreviated as evidence/ and plan/ above are under docs/comments-annotations/; estimates include six changed lines for routine BRANCH.md checkbox updates. Count extra receipt/checklist edits before staging; split them if needed.
