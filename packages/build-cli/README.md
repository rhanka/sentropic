# @sentropic/build-cli

The `stp app` processes of the Sentropic umbrella CLI (`@sentropic/cli`). It owns the app
scaffolder/builder: a deterministic, dependency-light templating substrate (`{{token}}`
substitution + a scaffold manifest) and a pure generator core that resolves a manifest plus
options into an ordered, byte-identical list of output files (the R10 determinism invariant).
The substrate sits behind a small interface so it can later be lifted into `@sentropic/harness`
(R5). The materialised chat-app mounts the published `@sentropic/chat-server` canonical routes;
it does not own the wire protocol.

## Publishing

This is a published `@sentropic/*` workspace package (`tsc` build to `dist/`, ESM, OIDC trusted
publisher). The **first** publish requires the one-shot bootstrap (`workflow_dispatch` with
`bootstrap_publish_target=build-cli`, uses `NPM_TOKEN`) followed by attaching the OIDC trusted
publisher on npmjs.com. See `rules/workflow.md → Package Publication`.
