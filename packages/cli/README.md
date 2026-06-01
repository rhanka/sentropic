# @sentropic/cli

The Sentropic umbrella CLI. Binary **`stp`** (alias **`sentropic`**) federates the ecosystem as
subcommands (`stp` = « s'il te plaît », so `stp h2a` reads "please, h2a"). BR-42a1 ships the
subcommand-registration seam plus `stp app` (delivered by `@sentropic/build-cli`). The federation
points `stp graphify …`, `stp h2a …`, and `stp remote …` are **reserved** and OUT of BR-42a scope
— each lives in its own repo and self-registers later.

> Status: skeleton only. The umbrella dispatch logic lands in lot a2.

## Publishing

This is a published `@sentropic/*` workspace package (`tsc` build to `dist/`, ESM, OIDC trusted
publisher). The **first** publish requires the one-shot bootstrap (`workflow_dispatch` with
`bootstrap_publish_target=cli`, uses `NPM_TOKEN`) followed by attaching the OIDC trusted publisher
on npmjs.com. See `rules/workflow.md → Package Publication`.
