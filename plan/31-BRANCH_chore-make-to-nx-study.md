# Branch Plan Stub: BR-31 Make to nx Migration Study

Status: **study closed (2026-05-13)** — recommendation **REJECT** (with optional power-developer adapt sub-option). No further lots; PR open for archival record only.

Source spec:

- `spec/SPEC_STUDY_MAKE_TO_NX_MIGRATION.md` (delivered in this branch, 497 lines)
- Referenced clause: `rules/architecture.md` "do not introduce Nx or another orchestrator as a required workflow without a dedicated architecture decision" — this study IS that dedicated decision.

Branch:

- BR-31 `chore/make-to-nx-study`
- Worktree: `tmp/chore-make-to-nx-study`
- Commits: `681790fa` (BRANCH.md) + `38d8f1d3` (spec)

Ordering rule:

- BR-31 is **standalone** (doc-only). No runtime dependency, no consumer branch.
- Conclusion locks the existing Make-only Docker-first contract on `main`; no follow-up branch is queued.

Scope summary:

- Inventory: 149 Make targets grouped by domain, 21 CI jobs grouped by lane, root + per-package `package.json` workspaces.
- Simulated nx adoption: dependency graphs today vs nx, CI job-by-job before/after, misconfiguration risk.
- Transition plan (rejected): one-branch transition plan with Lots 0-5 (~500-900 lines, 5-7 commits) kept for record.
- Recommendation: **REJECT** the migration. Sub-recommendation: optional adapt for power-developers (selective rebuilds via a thin Make wrapper that hashes inputs).

Before implementation:

- N/A — study closed. If user later overturns the recommendation, restart from `spec/SPEC_STUDY_MAKE_TO_NX_MIGRATION.md` §6 (Lot 0-5 transition plan).
