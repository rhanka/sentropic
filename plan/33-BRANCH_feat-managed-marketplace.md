# Branch Plan Stub: BR-27 Managed Marketplace

Current coordination source:

- `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` (§1, §15) + `spec/SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md`
- `spec/SPEC_VOL_MARKETPLACE.md` (to be authored in BR-23 PR #148 scope)

Branch:

- BR-27 `feat/managed-marketplace`
- Worktree (when launched): `tmp/feat-managed-marketplace`

Ordering rule:

- BR-27 runs after BR-19 (`feat/agent-sandbox-skills`) because `@sentropic/marketplace` overlays governance/policy/audit on top of `@sentropic/skills` (`SkillsToolRegistry`).
- BR-27 has no runtime dependency on BR-26 (`flow`); marketplace decisions apply at `ToolRegistry` resolve time in both chat-core and flow paths.

Scope summary:

- Ship `@sentropic/marketplace` (runtime package) with `MarketplaceEngine` (`evaluate` / `listAllowed` / `audit`).
- Compose with `SkillsToolRegistry` via `MarketplaceEngine.evaluate(actor, action, target)` at invocation, install, publish.
- Reference impl: in-memory + Postgres audit-log adapter (production lives in `@sentropic/persistence-postgres`).
- Out of scope v1: marketplace admin UI for policy editing and approval queue (deferred).
- Distinction: owns the *organizational rules* on skills; the catalog itself stays in BR-19.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Inventory the `SkillsToolRegistry` invocation points (chat-core, flow) requiring `evaluate()` integration.
- Define exact `MarketplacePolicy` defaults (sources allowlist, role allowlist, audit level).
