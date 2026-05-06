# Branch Plan Stub: BR-14f Node Workspace Monorepo Infra

Current coordination sources:

- `PLAN.md`
- `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`

Branch:

- BR-14f `chore/node-workspace-monorepo-14f`

Ordering rule:

- BR-14f lands before the BR-14c thin app proof path when the repo still mounts `api` and `ui` as isolated containers.
- BR-14f owns the repo/tooling baseline only; BR-14c still owns the `@entropic/llm-mesh` contract and its API proof after rebase.
- BR-14f is activated only by downstream consumption: BR-14c must create the first `packages/*` package and prove `api/` imports it through the root workspace; BR-14b and BR-14a then consume that package contract from runtime and chat extraction work.

Scope summary:

- Add a private root Node workspace manifest.
- Rewire Docker dev/test mounts to the repo root with explicit working directories.
- Keep `make` as the top-level orchestrator; do not switch to Nx.
- Keep `api/` and `ui/` as application roots; do not move them under `packages/`.
- Assess and document rebase impact on BR-14c, BR-16a, and BR-21a.
- Preserve local dev/UAT capacity: the isolated `make dev` stack must boot with branch ports before merge.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Keep the first slice limited to infra/tooling and compatibility proofs.
