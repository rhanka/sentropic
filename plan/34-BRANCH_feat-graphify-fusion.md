# Branch Plan Stub: BR-28 Graphify Fusion

Current coordination source:

- `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` (§1 cartography, §13 harness ↔ graphify integration)
- `spec/SPEC_VOL_GRAPHIFY.md` (to be authored in BR-23 PR #148 scope)

Branch:

- BR-28 `feat/graphify-fusion`
- Worktree (when launched): `tmp/feat-graphify-fusion`

Ordering rule:

- BR-28 is **standalone** — it has no runtime dependency on any other in-flight branch.
- BR-28 may be scheduled in parallel with BR-26/BR-27/BR-29/BR-30 as capacity allows; the only coupling is that `@sentropic/harness` (BR-25) declares `@sentropic/graphify` as `peerDependency`.

Scope summary:

- Fuse the existing upstream `graphifyy@0.7.10` package under the `@sentropic/graphify` namespace.
- Deliverables: knowledge graph extraction CLI binary (`graphify`), ESM+CJS dual build, cross-CLI skill format (Claude Code, Codex, Gemini, Aider, OpenCode), and HTML+JSON+audit publication artifacts.
- Decision required as Lot 0: npm registry transfer of `graphifyy` vs new publication of `@sentropic/graphify` + upstream deprecation. Rationale documented in the future `BRANCH.md`.
- Surface consumed by harness: `harness graph extract`, `harness graph query`, `harness graph publish`.
- Boundary rule preserved: graphify is a dev/exploration tool, **not** a runtime dependent of chat-core/flow.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Inventory `graphifyy@0.7.10` upstream code, license, npm ownership, current consumers.
- Capture the registry-transfer-vs-republish decision with rollback plan.
