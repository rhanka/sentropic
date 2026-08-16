# Recurring LLM Model Update Runbook

## Purpose and reference

Use this procedure for a real provider model addition or cutover, such as `3.7 -> 3.8` or a new Claude, GPT, or Gemini generation. It is an owner facilitation runbook, not evidence that a named model exists.

Canonical repository example: PR #540, branch `origin/feat/llm-mesh-gemini-37`, based on `84512941a`. Its useful pattern is catalog -> providers -> council -> routes -> package version -> consumers -> tests. Do not copy its model specifications into another update: limits, modalities, endpoints, and identifiers are model-specific.

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
- Read the current model paths and the complete reference delta. Do not assume PR #540 is merged.
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
