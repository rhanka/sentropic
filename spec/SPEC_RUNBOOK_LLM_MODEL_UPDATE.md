# Recurring LLM Model Update Runbook

## Purpose and reference

Use this procedure for a real provider model addition or cutover, such as `3.7 -> 3.8` or a new Claude, GPT, or Gemini generation. It is an owner facilitation runbook, not evidence that a named model exists.

Canonical repository example: PR #540, merged into `origin/main` as `28d57d098` after originating from base `84512941a`. Its useful pattern is catalog -> providers -> council -> routes -> package version -> consumers -> tests. Do not copy its model specifications into another update: limits, modalities, endpoints, and identifiers are model-specific.

## Required inputs

- `MODEL`: exact provider model id, including any provider-required date/version suffix.
- `BASE`: an existing catalog model from the same provider and transport family.
- Official evidence URL(s), retrieval date, quoted exact id, target endpoint/product, and availability scope.
- Owner decision: catalog-only addition, faithful host target, or default/alias cutover.
- Branch/worktree, dedicated `ENV=test-<slug>`, and a `BRANCH.md` scope exception before touching conditional paths.

## Gate 0: prove the model is real (anti-phantom)

Stop before scaffolding until the PR records primary vendor evidence for the exact model id:

1. Search the vendor's official model registry, release notes, and API documentation. Start with [OpenAI models](https://developers.openai.com/api/docs/models), [Anthropic models](https://platform.claude.com/docs/en/about-claude/models/overview), or [Gemini models](https://ai.google.dev/gemini-api/docs/models).
2. Copy the exact machine id, not a marketing label or an inferred version sequence. A blog headline alone is insufficient.
3. Record whether the id applies to the direct API, Codex, Claude Code, Gemini API, Cloud Code/agy, GCP Model Garden, or another surface. Availability on one surface does not prove another.
4. Confirm every claimed capability independently: context and output limits, modalities, tools, structured output, reasoning controls, and streaming wire shape. Unknown values remain `unknown`; never inherit them silently from `BASE`.
5. When credentials and vendor policy allow, add a minimal live discovery/call receipt with secrets redacted. A failed or unavailable target is a stop condition, not a reason to mint a plausible id.

The evidence block must include a retrieval date because vendor pages are mutable. If sources disagree, the narrowest official claim wins and the source gap remains explicit in the PR.

## Procedure

### 1. Establish scope and inspect the reference

- Verify the worktree with `harness check branch` before editing and `git branch --show-current` immediately before every commit.
- Read the current model paths and the complete reference delta. Confirm the reference merge state; this runbook branch now includes PR #540 in its base.
- Declare exceptions for `Makefile`, workflows, lockfiles, API contracts, or generated sources before editing them.

### 2. Preview and apply the mechanical scaffold

Preview first; it must not modify the tree:

```sh
make llm-mesh-add-model MODEL=<exact-id> BASE=<existing-id> DRY_RUN=1
```

After Gate 0 evidence and review of the preview:

```sh
make llm-mesh-add-model MODEL=<exact-id> BASE=<existing-id>
```

The scaffold copies three structural stubs: the catalog profile, both provider registries, and a faithful default target. It is idempotent and repairs missing provider-list entries. It deliberately does not change standard aliases, capability aliases, the council, versions, consumers, or lockfiles. It refuses a `BASE` without a faithful route so a human must design that transport rather than guess it.

### 3. Replace the catalog stub with verified specifications

- In `packages/llm-mesh/src/catalog.ts`, compare the new object field-by-field with `BASE`.
- Replace the `[VERIFY]` label and remove the scaffold comment.
- Verify `providerId`, `reasoningTier`, task hints, all capability support levels, context/output limits, and input/output modalities.
- Add a small model-specific capability constant only when the official model differs from the provider/base template. Do not broaden the provider profile to fit one model.
- Add no GCP/provider variant without independent evidence for that exact surface and wire id.

### 4. Complete the provider registries

Confirm the exact id occurs once in `knownModelIds` and once in the matching `knownModelIdsByProvider` list in `packages/llm-mesh/src/providers.ts`. Preserve GCP qualified-key rules and do not advertise transport-only compatibility ids as catalog models.

### 5. Make routing decisions explicitly

Review all three routing concerns in `packages/llm-mesh/src/routing-targets.ts`:

- `DEFAULT_TARGET_MAPPINGS`: retain the scaffolded entry only if the model has a faithful callable host transport.
- `STANDARD_ROUTE_DEFINITIONS`: change a Codex/Cloud Code candidate only for an owner-ratified default or fallback cutover. Preserve effort tiers and add exhaustive alias tests.
- `CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL`: map only transport ids absent from the catalog to a verified catalog capability source. When a legacy transport alias remains, repoint it deliberately and test the compatibility behavior.

Launch routing is not benchmark equivalence. Never use a route change as evidence that two models are interchangeable.

### 6. Classify the model in the equivalence council

Every catalog model must be classified exactly once. The current safe path is explicit exclusion:

1. Add `<provider>:<MODEL>` to `excludedModelKeys` in `scripts/llm-model-equivalences/council.source.json`.
2. Update the revision, reviewer, provenance, and expiry when required by the council review.
3. Run `make refresh-llm-model-equivalences ENV=test-<slug>`; never edit `generated-model-council.ts` by hand.
4. Run `make check-llm-model-equivalences ENV=test-<slug>` and the equivalence-council tests.

The current generator emits exclusions only. Creating a benchmark-backed equivalence group requires a separately reviewed source/generator evolution; do not encode it as an ad hoc generated-file edit. Freshness is already enforced in mesh validation and in both publication targets, so a model addition that omits this step must fail closed.

### 7. Update every repository consumer

Inventory consumers on every update; the current tree has these distinct obligations:

| Consumer | Required action |
|---|---|
| `packages/llm-gateway` | Raise the `@sentropic/llm-mesh` dependency floor to the new mesh version, bump gateway at least patch so the new manifest can publish, update route fixtures, then regenerate the root lock. |
| `api` | Its manifest is a `file:` workspace link, so normally keep that specifier; regenerate `api/package-lock.json` so workspace version metadata is current, and update the exact public catalog plus stream fixtures. |
| Root workspace | Run `make lock-root`; verify the linked mesh version and gateway dependency range changed together. |
| `packages/build-cli/templates/chat-app` | Raise the generated app's published mesh range and its golden assertion so newly generated apps can select the model. If intentionally held back, record an owner-approved source gap and compatibility reason. |
| External h-cond / h2a-runtime hosts | No in-repo dependency exists. Send a handoff after publication for host catalog/default changes, especially agy/Cloud Code. |

Use `make lock-root ENV=test-<slug>` and `make lock-api ENV=test-<slug>`; never hand-edit lockfiles. Re-run the consumer inventory rather than assuming this list is permanent.

### 8. Add model-specific and regression tests

At minimum, cover each touched behavior:

- `packages/llm-mesh/tests/facade.test.ts`: exact identity and every verified capability that differs from `BASE`.
- `packages/llm-mesh/tests/equivalence-council.test.ts`: classification remains exhaustive and fail-closed.
- `packages/llm-mesh/tests/routing-targets.test.ts`: faithful target, all changed aliases, effort preservation, and capability-source resolution.
- Account inventory and transport client tests when a host default or wire id changes.
- `packages/llm-gateway/tests/target.test.ts`: downstream canonical route view.
- `api/tests/api/models.test.ts`: exact provider list and total.
- `api/tests/unit/llm-runtime-stream.test.ts`: advertised model's content, tool, reasoning, status, and usage normalization.
- `packages/build-cli/tests/generator-golden.spec.ts` when the template dependency changes.

Run focused tests while editing, then the package and repository gates:

```sh
make check-llm-model-equivalences ENV=test-<slug>
make test-llm-mesh ENV=test-<slug>
make test-llm-gateway ENV=test-<slug>
make build ENV=test-<slug>
make typecheck ENV=test-<slug>
make lint ENV=test-<slug>
make test ENV=test-<slug>
make scope-check ENV=test-<slug>
```

Also run `harness check scope`. Live provider tests may be classified as AI-flaky only under the repository rule: an identical same-commit command must also pass and the owner must sign off. Missing credentials are a source gap, not a passing result.

### 9. Version, package, publish, and verify in order

1. Run `make audit-llm-routing-package-versions` before choosing versions and again after any rebase.
2. A new catalog model is a mesh feature: bump `packages/llm-mesh/package.json` minor while pre-1.0, unless the public contract requires a major bump.
3. Bump `packages/llm-gateway/package.json` at least patch whenever its mesh dependency or published route contract changes. Merely changing its dependency without a new gateway version leaves the registry manifest unpublished.
4. Regenerate both required lockfiles and run `make package-llm-routing-candidates` plus pack gates.
5. Open the PR and require green mesh, gateway, API, package-bump, council-freshness, and full repository gates. Do not publish manually from the branch.
6. After merge, CI publishes mesh first. Gateway publication waits for the mesh version to be visible, then builds and publishes against it.
7. Confirm npm versions and required tags `@sentropic/llm-mesh@<version>` and `@sentropic/llm-gateway@<version>`. Publication without the release tag is incomplete under repository policy.
8. Smoke the published artifacts, not only workspace links, before changing external host defaults.

### 10. Notify external host-default owners

Send h-cond/h2a-runtime a handoff containing: exact published mesh/gateway versions and tarball hashes, official model evidence, old/new ids, affected aliases and effort tiers, transport/product availability, smoke results, rollback ids, and PR/CI links. Explicitly name agy when Cloud Code inventory or its default changes. This repository cannot apply that default; acknowledgement from the external owner is the acceptance evidence.

## Current-tree file map

Line anchors below refer to base `28d57d098` plus this runbook/scaffold branch.

| Concern | Current file:line | Why it changes |
|---|---|---|
| Profile contract and profiles | `packages/llm-mesh/src/catalog.ts:27`, `:227`, `:266` | Profile shape, inherited capabilities, real model record. |
| Provider registries | `packages/llm-mesh/src/providers.ts:13`, `:59` | Known id union and provider-indexed list. |
| Faithful/default targets | `packages/llm-mesh/src/routing-targets.ts:28` | Callable canonical host target. |
| Standard alias candidates | `packages/llm-mesh/src/routing-targets.ts:56` | Owner-ratified Codex/Cloud Code route cutover. |
| Capability aliases | `packages/llm-mesh/src/routing-targets.ts:80` | Resolve transport-only ids to verified catalog capabilities. |
| Council source | `scripts/llm-model-equivalences/council.source.json:1` | Explicit exclusion and review metadata. |
| Council generator/output | `scripts/llm-model-equivalences/refresh.mjs:5`, `packages/llm-mesh/src/generated-model-council.ts:1` | Regenerate; never hand-edit output. |
| Scaffold entrypoint | `Makefile:595`, `packages/llm-mesh/scripts/add-model.mjs:1` | Preview/apply the mechanical copy. |
| Council CI gate | `.github/workflows/ci.yml:502` | Freshness runs before typecheck/test/build/pack. |
| Mesh/gateway publish order | `.github/workflows/ci.yml:1418`, `:1442` | Gateway depends on successful/skipped mesh publication. |
| Mesh/gateway publish recipes | `Makefile:749`, `:661` | Both include council freshness; gateway waits for mesh. |
| Package versions | `packages/llm-mesh/package.json:3`, `packages/llm-gateway/package.json:3` | Publishable semver identities. |
| Gateway dependency | `packages/llm-gateway/package.json:36`, `package-lock.json:18209` | New mesh floor and root lock. |
| API workspace consumer | `api/package.json:73`, `api/package-lock.json:86` | File link plus synchronized workspace metadata. |
| Generated-app consumer | `packages/build-cli/templates/chat-app/package.json:20`, `packages/build-cli/tests/generator-golden.spec.ts:77` | New app dependency and golden contract. |
| Public API contract | `api/tests/api/models.test.ts:20` | Exact catalog response. |
| Council and route tests | `packages/llm-mesh/tests/equivalence-council.test.ts:9`, `packages/llm-mesh/tests/routing-targets.test.ts:9` | Exhaustiveness and canonical routing. |
| Gateway route contract | `packages/llm-gateway/tests/target.test.ts:143` | Consumer sees the same canonical targets. |

## Source gaps and stop conditions

- PR #540 is merged into this runbook's base; its Gemini 3.7 ids, routes, and `@sentropic/llm-mesh` 0.16.0 state are current-tree reference material, not specifications to copy blindly into a future model update.
- `api/package-lock.json` currently records an older mesh workspace version than the root manifest. A future update must regenerate and review it rather than preserving the drift.
- The build-cli template currently pins an older pre-1.0 mesh range. Updating or explicitly deferring it is mandatory consumer review.
- Host defaults for h-cond/h2a-runtime and agy live outside this repository; the job stops at a documented handoff until that owner acknowledges it.
- Stop on absent official id evidence, a `BASE` without a faithful route, unclassified council membership, stale generated output, an unbumped publishable consumer, red tests, or unpublished dependency ordering.

## Done definition

The update is done only when evidence, catalog, provider registries, council, routes, consumers, lockfiles, tests, semver, ordered npm publication, release tags, published-artifact smoke, external host notification, and rollback notes are all recorded. The PR remains unmerged until its requested blind review and CI gates are complete.
