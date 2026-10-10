# Required CI checks

The `ci-gate` job in [ci.yml](workflows/ci.yml) aggregates all 38 PR validation,
build, test, and security jobs. It runs with `if: always()`, prints each dependency
and its result, and fails when any result is `failure` or `cancelled`. Results of
`success`, `skipped`, and `neutral` pass. Path-filtered jobs keep their conditions.
Matrix jobs contribute their aggregate result through GitHub's `needs` context;
existing `continue-on-error` policies remain in effect.

Publication jobs (`publish-*`, `bootstrap-publish`), the main-only post-publication
`verify-train-lock-integrity` job, and `deploy-preprod` are excluded because they
do not validate a PR before merge. Future PR gates must be added to `ci-gate.needs`.

After this workflow merges and `ci-gate` has passed, the conductor must replace
`main`'s required status contexts with exactly:

- `changes`
- `enforce-package-bump`
- `validate-publishable-manifests`
- `ci-gate`

`ci-gate` deliberately has no custom job name: its emitted check context matches
its job ID. Remove individual path-filtered and matrix contexts from required
checks so an unnecessary job cannot block a merge. Keep other branch-protection
settings in place. Workflow edits alone do not change repository settings.

For rollback, remove the required `ci-gate` context before removing its job and
explicitly choose the replacement protection policy.
