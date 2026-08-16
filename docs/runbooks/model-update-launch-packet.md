# MODEL UPDATE Launch Packet

Use this packet for the recurring owner directive:

> MODEL UPDATE: update model `<MODEL>` from base `<BASE>`.

The intended owner experience is one directive, one make scaffold, and one blind consensus review. The conductor remains responsible for evidence, scope, integration, publication ordering, and external handoff.

## Drumbeat mandate (copy/paste)

```text
MANDATE: MODEL UPDATE
MODEL: <exact-provider-model-id>
BASE: <existing-same-provider-model-id>
REPOSITORY: <absolute-sentropic-worktree>
BRANCH: feat/<model-update-slug>
ENV: test-<model-update-slug>

Outcome: ship one real, fully classified and routed model update through
@sentropic/llm-mesh, every in-repo consumer, ordered npm publication, and the
h-cond/h2a-runtime host-default handoff. PR only; do not merge.

Conductor actions:
1. Verify the branch mechanically and declare BRANCH.md scope/exceptions.
2. Require primary vendor evidence for the exact MODEL id and target product.
3. Dispatch the build lane with the packet below.
4. Integrate only scoped, atomic commits and run every gate below.
5. Dispatch blind review on the exact integrated commit/diff.
6. Reconcile findings, push, open the PR, wait for CI, and report; never merge.

Stop immediately for: marketing-only/unofficial id; ambiguous target product;
unverified capabilities; BASE without a faithful route; council omission;
unbumped publishable consumer; red deterministic test; scope failure; or a
publication/default change outside this mandate.
```

## Mesh build lane (Codex 5.6 Sol xhigh)

Dispatch through the installed h2a launch surface with `profile=codex`, `model=gpt-5.6-sol`, `effort=xhigh`, `gateway=auto`, `background=true`, and the absolute isolated worktree. The declared model/effort are a request; the current receipt does not attest effective post-routing identity.

```text
ROLE: implementation lane for MODEL UPDATE <MODEL> from BASE <BASE>.

Read, in order: rules/MASTER.md, rules/workflow.md, rules/subagents.md,
BRANCH.md, spec/SPEC_RUNBOOK_LLM_MODEL_UPDATE.md, and the relevant testing
rules. Work only in <ABSOLUTE_WORKTREE> on <BRANCH>. Use only make targets;
ENV=test-<slug> is last. Stage explicit files and commit only through
make commit MSG="...". Keep every commit under 150 changed lines.

Evidence gate: quote the exact official MODEL id, URL, retrieval date, target
API/account transport, availability, and each claimed capability. Do not run
the scaffold until this gate passes. Never infer a version from MODEL or BASE.

Run exactly one scaffold preview, inspect it, then apply:
make llm-mesh-add-model MODEL=<MODEL> BASE=<BASE> DRY_RUN=1
make llm-mesh-add-model MODEL=<MODEL> BASE=<BASE>

Replace every scaffold marker with verified data. Explicitly review catalog,
both provider registries, DEFAULT_TARGET_MAPPINGS, STANDARD_ROUTE_DEFINITIONS,
CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL, council classification and generation,
all internal consumers/lockfiles, package versions, API/stream fixtures, and
host inventory/default tests. Do not alter standard aliases without an owner
cutover decision. Do not hand-edit generated-model-council.ts.

Deliver atomic commits plus a report containing: evidence; changed files;
consumer inventory; exact tests/results; versions; source gaps; rollback;
scope exception ids; and the external h-cond/h2a-runtime handoff payload.
Do not push, publish, merge, or change external host defaults unless the
conductor explicitly grants that action.
```

## Mandatory gates before review

- Anti-phantom evidence names the exact model and exact product/transport.
- No `[VERIFY]` label or `MODEL UPDATE SCAFFOLD` comment remains.
- The new catalog model is classified exactly once; generated council is fresh.
- Faithful routes and every changed alias/capability source have exhaustive tests.
- Gateway dependency and version, root/API locks, API contracts, and build-cli template are updated or explicitly owner-deferred.
- Mesh is versioned before gateway; publishable manifests have new versions.
- Focused tests, mesh/gateway tests, `make build`, `make typecheck`, `make lint`, `make test`, `make scope-check`, and `harness check scope` are green.
- Candidate tarballs and hashes exist; no manual npm publication occurred.
- Every commit is scoped, atomic, and made on the named branch.

## Blind review lane (Claude Opus 4.8)

The primary review request uses h2a with `profile=claude`, `model=claude-opus-4-8`, `effort=xhigh`, `gateway=required`, and `background=true`. Follow `harness/review`: record author metadata, exact target ref and diff SHA-256, create the repo-local review stub first, keep the reviewer blind to other reviews, and add a second eligible independent Claude-hosted leg when consensus policy requires it.

```text
ROLE: blind adversarial reviewer for MODEL UPDATE <MODEL> from BASE <BASE>.
TARGET: <EXACT_COMMIT_OR_DIFF_SHA256>
WRITE ONLY: <REVIEW_ARTIFACT_PATH>

Do not read author explanations or another review. Read the repository rules,
the runbook, the exact target diff, PR #540 only as a historical pattern, and
the cited current-tree sources. Refute by default.

Audit: official model-id evidence and surface availability; copied capability
accuracy; provider registry completeness; faithful/default/alias routing;
council classification and generated freshness; all consumer/version/lock
bumps; mesh-before-gateway publication; test coverage; scaffold idempotence and
dry-run immutability; source-gap honesty; rollback; and external host handoff.

Write the required machine-readable review header, findings with severity and
file:line evidence, and APPROVE / REQUEST_CHANGES. Never edit implementation,
push, publish, merge, or inspect another review artifact.
```

## PR and report contract

Open the PR with the branch plan as body and title appropriate to the concrete model. Require green CI and resolved consensus findings. Report the PR URL, head SHA, CI run, npm plan, external handoff status, and explicit `PR only — not merged` state to the drumbeat. A future host-default cutover is a separate acknowledged action after published-artifact smoke.
