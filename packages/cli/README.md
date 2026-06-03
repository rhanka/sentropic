# @sentropic/cli

The Sentropic umbrella CLI. Binary **`stp`** (alias **`sentropic`**) federates the ecosystem as
subcommands (`stp` = « s'il te plaît », so `stp h2a` reads "please, h2a"). BR-42a1 ships the
subcommand-registration seam plus `stp app` (delivered by `@sentropic/build-cli`).

## Usage

```
stp <subcommand> [args...]
stp --version | -v        # CLI version + each registered subcommand's version
stp --help | -h           # list registered subcommands

stp app init <name> [...]  # scaffold a runnable @sentropic chat app
stp app doctor             # non-mutating pre-flight checks
stp app --help             # subcommand-specific help
```

Unknown subcommands fail with a non-zero exit code and list the available subcommands.

## Subcommand registration seam

The umbrella core (`src/cli.ts` + `src/registry.ts`) is plugin-agnostic: it reads only the typed
`Subcommand` contract via `SubcommandRegistry`. Each subcommand package implements
`{ name, summary, version, run(argv) => Promise<number> }`; the `stp` bin (the composition root)
imports the plugin (`@sentropic/build-cli`) and registers it. This keeps the core free of any hard
dependency on its plugins — `@sentropic/build-cli` never imports `@sentropic/cli`, so there is no
cycle. A package-name-convention resolver (auto-discovering installed `@sentropic/*-cli`) can sit on
top of this same contract later (not built here).

## Reserved federation points (OUT of BR-42a scope)

`stp graphify …`, `stp h2a …`, and `stp remote …` are **reserved** federation points — each lives in
its own repo and self-registers through the seam above in a later branch. They are intentionally NOT
shipped by BR-42a1; only `stp app` is a real subcommand for the MVP.

## Publishing

This is a published `@sentropic/*` workspace package (`tsc` build to `dist/`, ESM, OIDC trusted
publisher). The **first** publish requires the one-shot bootstrap (`workflow_dispatch` with
`bootstrap_publish_target=cli`, uses `NPM_TOKEN`) followed by attaching the OIDC trusted publisher
on npmjs.com. See `rules/workflow.md → Package Publication`.
