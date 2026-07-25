# Fix: align the CI `changes` filters with the image content-sha inputs

## Objective
`deploy-preprod` pins the immutable per-content image tags `API_VERSION` / `UI_VERSION`, computed in
the `Makefile` from an explicit list of paths. `publish-api-image` / `publish-ui-image` are gated on
the `dorny/paths-filter` outputs `changes.api` / `changes.ui`. Those two path sets had drifted apart,
so a path that feeds the sha but is absent from the filter bumps the tag the deploy pins **without
ever building it** — the tag does not exist in the registry, the pod goes ImagePullBackOff, and the
preprod rollout never completes.

`UI_VERSION` reads `packages/chat-ui/src`, `packages/cowork-desktop/**` and `packages/cowork-bridge/**`,
none of which were in the `ui` filter (`ui/**` only). Effect: `publish-ui-image` has been `skipped` on
every merge to `main` since PR #414 (2026-07-13) — 25 consecutive merges — while the pinned
`UI_VERSION` kept moving. `https://preprod.sentropic.sent-tech.ca/` has served 404 ever since, and the
condition is self-perpetuating: no ui-only change can occur to break the loop.

`API_VERSION` reads `packages/comments/src` (+ `package.json` / `tsconfig.json`), also absent from the
`api` filter — the same latent defect, not yet triggered.

This is distinct from the OpenAI-quota outage that separately skipped `publish-*-image` on 24-25/07;
that one is resolved and `publish-api-image` succeeded on the #450 merge run.

## Scope / Guardrails
- Single-file change: the `api` and `ui` entries of the `paths-filter` block in `.github/workflows/ci.yml`.
- Additive only — paths are added, none removed. A filter that is a superset of the sha inputs is safe
  (it can only publish an image that was already going to be pinned); a subset is what breaks preprod.
- No Makefile change: the `API_VERSION` / `UI_VERSION` definitions are the reference and stay untouched.
- Make-only workflow. All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `.github/workflows/ci.yml` (paths-filter `api` / `ui` entries only) — see `BRci-EX1`
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`, `apps/**`, `deploy/**`

## Feedback Loop
- `BRci-EX1` — exception to touch the Conditional Path `.github/workflows/**`.
  - Reason: the defect *is* in the workflow. The filter is the gate that decides whether the pinned
    image gets built; it cannot be repaired from anywhere else.
  - Impact: `publish-api-image` / `publish-ui-image` now also run when `packages/comments`,
    `packages/chat-ui`, `packages/cowork-desktop` or `packages/cowork-bridge` change. Strictly more
    publishes, never fewer; no job is removed, no gate is weakened, no `needs:` is touched.
  - Rollback: revert the single commit; the filters return to their previous value with no residue.
  - Owner ratification: decision taken 2026-07-25 ("Je corrige le filtre") after the root cause was
    evidenced against `Makefile` lines 34-35 and `ci.yml` lines 158-170.

## Verification
- Correspondence checked path by path against `Makefile` L34 (`API_VERSION`) and L35 (`UI_VERSION`):
  every sha input is now matched by a filter glob. The `api` filter keeps extra entries
  (`apps/auth-idp/**`, `flow`, `chat-core`, `events`, `contracts`) — a superset, deliberately kept.
- Merge-run evidence to confirm the fix: `publish-ui-image` must stop reporting `skipped` on the next
  merge that touches any `UI_VERSION` input.

## Lots
- [x] Lot 0 — Branch + worktree + BRANCH.md + `BRci-EX1`
- [x] Lot 1 — align the `api` and `ui` filters with the sha inputs
- [ ] Lot 2 — PR + CI green + merge

## UAT (owner)
- [ ] After merge, on the next `main` run: `publish-ui-image` is no longer `skipped`, the image is
      pushed, and `https://preprod.sentropic.sent-tech.ca/` leaves 404.
