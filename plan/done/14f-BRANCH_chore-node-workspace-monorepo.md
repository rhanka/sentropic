# Branch Plan Stub: BR-14f Node Workspace Monorepo Infra

Current coordination sources:

- `PLAN.md`
- `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`

Branch:

- BR-14f `chore/node-workspace-monorepo-14f`

Ordering rule:

- BR-14f lands before the BR-14c thin app proof path when the repo still mounts `api` and `ui` as isolated containers.
- BR-14f owns the repo/tooling baseline only; BR-14c still owns the `@entropic/llm-mesh` contract and its API proof after rebase.
- Durable activation details live in `README.md`, `README.fr.md`, `rules/architecture.md`, `PLAN.md`, and `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`.

Scope summary:

- Add a private root Node workspace manifest.
- Rewire Docker dev/test mounts to the repo root with explicit working directories.
- Keep `make` as the top-level orchestrator; do not switch to Nx.
- Keep `api/` and `ui/` as application roots; do not move them under `packages/`.
- Assess and document rebase impact on BR-14c, BR-16a, and BR-21a.
- Preserve branch dev-stack capacity: the isolated `make dev` stack must boot with branch ports before merge. User smoke UAT remains on root `ENV=dev`.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Keep the first slice limited to infra/tooling and compatibility proofs.

Final status:

- PR #125 head `e7ff9880` is CI green after rerunning failed external-network jobs.
- Isolated branch dev-stack proof passed on `API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=chore-node-workspace-monorepo-14f`.
- Root user smoke UAT passed on `ENV=dev` with user data and fixed root ports `API_PORT=8787 UI_PORT=5173 MAILDEV_UI_PORT=1080`.
- BR-14c is the next activation branch and must prove `api/` consumes `@entropic/llm-mesh` through the root workspace.
