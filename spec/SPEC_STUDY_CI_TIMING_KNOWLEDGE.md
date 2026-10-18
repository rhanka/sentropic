# SPEC STUDY — CI timing knowledge for conductor integration planning

Status: **STUDY — draft repository artifact, 2026-10-18**. The approved paper design permits reversible drafting. This document proposes implementation contracts and gates; it records no owner selection, implementation, deployment qualification or cross-owner design freeze.

Lineage: consolidated from the approved study [S1], its adopted reconciliation [S3] and round-two review [S4]. Track: WP9 item `01M57FSNB4ZYA7N55GEWAN2016`, parent `01KYNH2CTQXQSGHD731H19T3XX`. Drafting base: Sentropic `8c3a44c176ee06c9e2d1666158079c23a8b731ab`; the historical measurement baseline below is distinct. Follow [the branch plan](../BRANCH.md), [workflow rules](../rules/workflow.md) and [the branch template](../plan/BRANCH_TEMPLATE.md).

Recommendation: commit a typed repository knowledge package with reproducible timing references and CI/CD and architecture subgraphs. Have the conductor and source planning skill consume an exact revision with Track, proposed changes and resource constraints. Capitalise bounded lessons through the existing Engram authority and qualified host seam. The Git-backed planner remains useful while that seam is unavailable.

## 0. Binding owner request

Verbatim from [S0], including its original spelling:

> séparément: track et lance l'étude suivante : la référence des temps estimée devra être une connaissance utilisée par le conductor pour l'optimisation des plan d'intégration et ameliorre la skill de planification. idéalement voir comment avec gr-conductor comment gérer ce type de knowledge spécifique a capitaliser pour le repo. poru moi CI CD et graphes d'archi devraient être commités et intégrés au graphe de connaissance (committés comme sous-graphe typé - pour le diag voir le meta model du design system aussi)

The required outcome is committed technical subgraphs, timing-informed integration planning, a source-level planning-skill change and a bounded gr-conductor seam. Only [D1](#d1) and conditional [D2](#d2) remain owner questions. Their answers are unnecessary for this documentation work.

## 1. Evidence baseline and limits

All numbers in this section are inherited historical evidence or explicitly modelled scenarios, not measurements of the drafting branch. [S1 §1; S2:15–39; E1]

| Input | Pinned identity or population | Interpretation |
|---|---|---|
| Repository extraction | `94a38286eae4dbbff1cde192faa4f332abe60efa` | 66 jobs, 171 `needs` links, 43 component roots and 72 consumer pairs. |
| Separate CI Lot 1 reference | PR #696, `38a3b8e5ad0e14136082f309c29f22fde6467779` | Measurement protocol snapshot; not the extraction revision. |
| Raw historical corpus | 1,558 workflow runs; 48,065 allocated job records | Keep run, attempt and job denominators separate. |
| Replay and pricing | 554 ancestry-valid diffs; 266 successful priced runs in an earlier comparison | These are distinct from per-job sample populations. |
| `validate-cluster-mesh` | Median 4.717 min, p90 5.567 min, 378 samples | Job service time, not integration completion. |
| Isolated cluster-mesh PRs | Lifecycle median 25 min, p90 41.683 min; 26 runs | Runner-work median 146.233 min; gate-delay statistics have their own denominator. |
| `validate-harness` | Median 0.617 min, p90 0.750 min; 709 samples | No isolated harness PR cohort; job observations do not fill that gap. |
| Isolated UI PRs | One run, approximately 13.983 min lifecycle | Insufficient evidence of a stable tail. |
| Archived presentation scenes | 67 jobs / 169 `needs`; 47 components / 163 typed edges over 77 relations | Historical view counts; never substitute them for the pinned extraction counts. |

The existing extractors cover workflow predicates/matrices, imports, manifests, Make prerequisites, Docker inputs/stages and test routing, with unresolved inputs and parse errors. The dossier's smaller PR-condition evaluator is bounded; it is not a general Actions interpreter. Reuse the extractors and fixtures rather than infer complete semantics from diagrams. [S2:39; E2]

Historical path filters select the same jobs for patch, additive and breaking changes. A root-lock change can select the wide profile (13.05 wall / 134.52 runner-minutes plus unmeasured artifact validation). Eighteen libraries lack dedicated validation lanes, and `apps/llm-gateway` lacks a CI lane in that baseline. Missing coverage is not a saving. [S1:24–30]

S1/S2/S3 remain future CI-strategy scenarios, respectively classification, consumer contracts with workspace consumption, and contracts with immutable artifacts. Their budgets and sums of historical medians are not measured percentiles. The common-guard allowance of 1.50 minutes remains `measured: false` even though the historical median happens to match. [S1:32–36; S2:37]

For illustration, compatible `comments` is modelled at 1.97 wall / 3.60 runner-minutes under S3 qualification, or 2.38 / 4.02 including indicative publication. `cluster-mesh` reaches 5.75 / 7.38, or 6.68 / 8.32 with publication. Combining them cannot establish a five-minute train. Those scenarios do not gate this knowledge program or authorize narrower qualification. [S1:34–36, 144, 324]

## 2. Timing contract

### 2.1 Distinct records and quantities

| Record | Required content |
|---|---|
| `TimingObservation` | Repository/provider/workflow identity, run and attempt, job and canonical matrix tuple, step identity where present, events/timestamps, result, execution mode, runner profile, actually attested source/head/base/tested revisions, locator and digest; explicit missing fields. |
| `TimingSeries` | Subject/metric, inclusion and exclusion predicate, compatible configuration regime, window and immutable sample manifest, run/attempt/usable-value counts, estimator and quantile-method versions, units, samples/distribution, missing and censored counts. |
| `TimingEstimate` | Series reference, p50/tail statistics and their denominators, applicability fingerprint, freshness, support level and limitations; historical bootstrap and matched current support are distinct. |
| `TimingBudget` | Subject, target/bound, rationale and decision reference, owner and revisit trigger; no empirical sample count or confidence claim. |
| `PlanPrediction` | Candidate/base pins, selected graph, timing digest, policy and resource snapshot, proposed order, gate/release delay, runner work, uncertainty method, unknown terms, phase intervals and selection rationale. |

`JobPrice`, cohort, selection-profile, strategy and publication-price displays are views over these records, not additional numerical authorities. Critical path and affected closure are derived values. Store durations in seconds with explicit units; keep service, wall, queue, step and runner quantities separate from money, provider calls, tokens and seat consumption. Provider-cost estimates require their own usage evidence and versioned pricing. [S1 §2.1; S2:41–51]

Measured statistics name their population, window, sample count and method. Modelled estimates combine evidence and explicit budgets and carry `measured: false`. Unknown (`NM`) stays symbolic with a reason and a measurement obligation; never substitute zero or a library average. Job quantiles cannot establish a workflow quantile by addition or a critical-path calculation. [S1:72–100]

### 2.2 Stable identity, regimes and clocks

Use repository key + workflow path + stable job ID + canonical matrix values. Steps use an explicit ID, otherwise a stable extractor key based on normalized command/action identity and occurrence. Keep display labels separate. Renames or ambiguous mappings need an explicit alias/migration or a new series; never pool similarly named jobs across workflows or repositories. [S2:53]

The regime fingerprint covers workflow/called-action digests, Make/test command closure, effective dependency locks, runner/OS/toolchain/container profile, shards, execution mode and relevant provider/model settings. Preserve unknown runner/cache information. Import existing prices as `historical-bootstrap`; do not manufacture distinctions missing from their evidence. [S2:55]

Keep four clocks: execution, evidence collection, reference publication and source/configuration applicability. Record the analyzed revision in the manifest; consumers record the containing publication commit afterward, avoiding a self-referential commit hash. Prior predictions remain immutable. [S2:57–63]

Successful service distributions, failure/cancellation rates and unsuccessful-attempt work remain separate. Link retries; treat interrupted jobs as censored observations, not completed short jobs. Distinguish skipped, allocated-empty, setup-only and active modes. Retry cost stays unknown or explicitly modelled until its failure classes and policy are supported. [S2:35, 59]

### 2.3 Applicability and permitted use

| Status | Condition | Permitted use |
|---|---|---|
| `applicable` | Compatible transitive regime fingerprint and sufficient inputs for the stated prediction | Drive scheduling and applicable timing gates with declared uncertainty; matching applicability is not a deterministic completion guarantee. |
| `conditional-historical` | Only historical/bootstrap or pre-change prices exist | Compare scenarios and discuss ordering; never supply a conservative completion bound or satisfy a timing gate. |
| `incomplete` | Missing reference or unknown required terms | Show known subtotal, symbolic terms and named measurement tasks; retain an untimed dependency plan. |

An unrelated commit with an unchanged transitive fingerprint preserves applicability. A changed runner/command/shard/dependency regime invalidates affected prices immediately; age alone cannot restore them. A workflow SHA change triggers fingerprint review, not blanket invalidation of unaffected jobs. Full-suite selection is conservative about coverage only. These three cases are mandatory consumer fixtures. [S1:148; S3 rows 9/13 and review treatment 4]

## 3. Publication, refresh and reproduction

Commit a compact manifest with `schemaVersion`, `repoKey`, analyzed revision, input-manifest digest, extractor/estimator/profile versions, observation-window manifest, typed subgraph paths/digests, superseded reference and freshness policy. Use SHA-256 for evidence and semantic payloads. Sanitize observations before persistence; raw jobs/steps remain in immutable evidence storage with committed compact manifests and small reproducibility fixtures. Scratch paths are bootstrap sources, not the durable storage contract. [S2:61–80]

| Trigger | Response |
|---|---|
| Workflow/action, Make closure, Docker input, test routing, matrix, runner or resolved dependency change | Refresh structural facts and invalidate affected regimes; expose dynamic/unresolved inputs. |
| Manifest/import/contract/deployment or architecture decision change | Refresh typed edges and CI-to-component links, retaining extraction versus reviewed declaration. |
| Completed CI attempt | Deduplicate by run/attempt/job, reconcile pending records and update observations outside the integration critical path. |
| Comparable prediction drift | Attribute service, capacity/queue, retry or closure error; publish a new reference and refresh affected recommendations. |
| Merge/rebase, candidate reorder or base advance | Rebuild for actual combined inputs; recompute remaining closure, acceptance and predictions. |
| Track head change | Refresh its read-only fragment and applicable blockers/decisions; collectors do not write realization events. |
| Engram eligibility/lifecycle change | Invalidate controlled runtime projections; do not alter committed technical facts. |
| Generator, estimator, profile or mapping change | Version the contract, replay golden fixtures and publish semantic differences. |

Reversible pilot defaults: daily collection, a rolling 30-day compatible window and weekly reference publication, plus immediate refresh on semantic changes. Require at least 20 compatible observations spanning seven days for a provisional baseline; mark tail support separately. A longer low-volume window preserves regime identity. Commit review thresholds for price movements and new unknowns. No sample-count threshold alone establishes a strong p95 guarantee. [S2:65; S1 §9]

Reuse the Lot 1 collection/comparison protocol, closing its cited snapshot gaps in K1: the dossier's `floor(n*q)` quantile differs from nearest rank; `minDays` was recorded but completeness checked run count alone; usable gate delays need their own minimum; `summarizeWindow` sums `llmMinutes` discarded by `redactJob`. Preserve historical methods and version changes. Do not infer elapsed-window coverage or measured zero LLM usage. Recheck the actual implementation before making fixes. [S2:80; E3]

Identical pinned inputs must produce identical semantic bytes. Generated facts are corrected through their source or generator, then regenerated and checked by CI diff; handwritten profiles/declarations remain reviewable source inputs. The integrator rebuilds the merged snapshot rather than choosing one branch's generated files. Retain evidence for the declared reproduction horizon and accepted-decision references; unavailable evidence explicitly means reproduction unavailable. [S1 §4.4; S2:63, 78]

## 4. Typed subgraphs and the design-system contract

### 4.1 One semantic profile, separate views

Use the actual `@sentropic/diagram-core` contracts pinned at DS `25c0f3d33c258fc2b906a4b85219ffce5f67eccc`: [SemanticDocument](https://github.com/rhanka/sent-tech-design-system/blob/25c0f3d33c258fc2b906a4b85219ffce5f67eccc/packages/diagram-core/src/document.ts#L127) holds entities, relations, ports, resources and versioned profiles; [ViewDocument](https://github.com/rhanka/sent-tech-design-system/blob/25c0f3d33c258fc2b906a4b85219ffce5f67eccc/packages/diagram-core/src/view.ts#L126) holds occurrences, geometry, grouping and presentation. The focus kit's SvelteFlow scenes are presentation instances, not the semantic schema. [S2:82–94; S3 row 18]

Declare one `repo-knowledge@1` profile with CI/CD, architecture and shared timing/provenance modules. The manifest separately types its subgraphs. The pinned [profile validator](https://github.com/rhanka/sent-tech-design-system/blob/25c0f3d33c258fc2b906a4b85219ffce5f67eccc/packages/diagram-core/src/profile.ts#L174) requires endpoint `entityTypes` to be declared in the same profile; a future profile split needs an explicit join contract. Attribute sets remain K0/K2 work with DS maintainers. [S4 finding 2]

| Module | Entity vocabulary | Principal relations and roles |
|---|---|---|
| Shared provenance/timing | Repository, SourceArtifact, EvidenceWindow, TimingReference, ExternalAnchor | `derivedFrom` (result, source), `supports` (evidence, claim), `supersedes` (new, previous), `references` (source, target). |
| CI/CD | Workflow, Job, JobVariant, Step, TestSuite, BuildArtifact, Environment, ResourcePool | `contains`, `precedes` (predecessor, successor), `awaitsResult` (producer, gate), `executes`, `producesArtifact`, `consumesArtifact`, `deploysTo`, `requiresResource`, `hasTiming` (subject, reference). |
| Architecture | Component, Package, Service, Interface, Contract, SourceFile, BuildTarget, Image | `dependsOn` (consumer, provider), `implements`, `providesInterface`, `consumesInterface`, `builtFrom`, `validates` (suite anchor, component/contract). |

Every relation has stable identity, named endpoint roles/cardinalities, provenance, source locators, extraction/declaration basis and explicit confidence (`EXTRACTED`, `INFERRED` or `AMBIGUOUS`, never defaulted). Keep runtime/dev/peer/import/test/protocol dependency categories. Explicitly convert the historical extractor's provider-to-consumer direction into the declared role convention. `awaitsResult` remains an execution wait even for an observing gate. Architecture cycles are valid findings; only selected execution predecessors must form a DAG. Proposed controls carry explicit proposed/inferred state and never masquerade as implemented edges. [S1 §5.2; S2:90–94]

Timing attributes include metric, mode, support, sample count, p50/p90, quantile method, window and evidence resource. Declare their types and units; missing estimates omit numeric attributes and state why. DS reference validation is complemented by repository checks for regime compatibility, conditional invariants, samples and required validation closure. A valid drawing schema alone proves no CI coverage. [S2:94]

### 4.2 Explicit, versioned adapters

Assign collision-checked stable DS slugs/hashes, preserving canonical external keys as typed attributes. Arbitrary slash-bearing graph IDs cannot be copied directly into restricted nominal `EntityRef`s. Cross-document references use declared `ExternalAnchor` entities bound to exact resource, revision and key; unresolved anchors remain visible and cannot justify smaller test selection. Resource resolution belongs to the repository adapter; DS itself does not fetch `artifact:` URIs. [S2:163–165; DS refs.ts:34, 57 at the pin above]

The committed semantic documents are the common CI/architecture source for downstream consumers, still derived from pinned Git and reviewed declarations. Timing attributes are generated from `timings.json` in the same publication transaction; the manifest and consistency checks prevent independently maintained prices. Generate Graphify fragments and renderer inputs from these sources. Never maintain parallel handwritten dependency lists. [S2:167]

Graphify's inspected loader uses `multi:false`, merges edges by endpoints and skips absent endpoints. Preserve each semantic relation as a uniquely identified relation node with role-labelled incidence edges and its original `RelationRef`; materialize anchors before assembly. Verify every relation and incidence survives, including parallel semantic relations. Raw edge-count equality across representations is not the invariant. A future multigraph replacement needs separate compatibility qualification. [S2:169; G1]

DS semantic declarations and the Engram ontology/extraction mapping are different artifacts. Generate and version the latter explicitly; use existing free-string `node_type`/`relation`, `extract --semantic`, `merge-graphs` and profile validation without adding an Engram core type. Its assertion-family registry is not an ontology import. [S5:9–12; S6:14–18]

Require `source_owner`, `source_id`, `observed_at`, `source_hash` and `adapter_version` at node/relation granularity, including source revision and ownership. Use SHA-256 for evidence/trust comparisons; DS's non-cryptographic FNV helper is not suitable. Topology weight never means duration. [S2:171; G1]

K2 fixtures separately assert source counts (66 jobs / 171 `needs` / 43 roots / 72 pairs), semantic endpoint/role validity, Graphify relation/incidence conservation and view occurrence references. Include a job-to-timing relation and a CI-to-architecture relation within the single profile. A view may repeat an entity; deleting an occurrence or changing layout cannot change semantic facts or the knowledge digest. Inspect provenance in the rendered detail view on desktop and mobile. [S4 findings 2 and 6]

### 4.3 Repository layout and ownership

These are proposed implementation paths, not files produced by this study. Maintainers may reuse equivalent existing locations in other repositories, while preserving the contract and recording the mapping. [S2:173–187; S3 row 27]

| Path or surface | Content | Owner |
|---|---|---|
| `knowledge/manifest.json` | Repo identity, schema/profile/source pins, graph/reference digests, window, publication lineage | Repository knowledge maintainer; conductor coordinates final merged snapshot. |
| `knowledge/profiles/*.json` | Reviewed domain profiles and compatibility declarations | Domain maintainers with DS review. |
| `knowledge/ci/graph.json` | CI/CD semantic document, including validation/publication/deployment | CI extractor and owning maintainers. |
| `knowledge/ci/timings.json` | Distinct series, estimates and budgets | Measurement adapter and normal repository review. |
| `knowledge/architecture/graph.json` | Components, contracts, build/runtime relations | Architecture extractor and maintainers. |
| `knowledge/evidence/manifests/*.json` | Immutable evidence locators, digests and selection rules; small golden fixtures | Collector/CI operations. |
| `knowledge/views/*.json` | Optional curated view documents; geometry is excluded from semantic digest | Diagram author. |
| `plan/<integration>/knowledge-lock.json` | Candidate/base, Track cursor, graph/timing/policy digests, capacity, prediction and unknowns | Source planning skill/conductor. |
| `scripts/ci/knowledge/**` | Proposed generator, validator and repository adapters | Repository tooling owner. |
| `.track/events.jsonl` | Existing realization, decisions and acceptance | Designated single writer. |
| `.engram/` or configured graph cache | Rebuildable technical fragments and audience-authorized current runtime projections | Assembly host; `.graphify/` may remain a configured/read compatibility path. |
| Host-owned Engram store | Canonical memory and lifecycle | gr-conductor and qualified host owner. |
| Immutable CI evidence store | Full sanitized observations retained for reproduction | CI operations. |

## 5. Authority boundary and capitalisation flow

gr-conductor identifies four surfaces: committed project sources (profiles, registries, mappings and reviewed declarations); generated `.engram/` state; canonical memory journal; and ontology lifecycle (proposal → deterministic validation → decision journal → `needs_update`). A generated graph stays derived even when tracked. Git/CI establish technical facts, Track establishes work/decision/acceptance state, and Engram's immutable records plus lifecycle journal are the sole memory authority. [S5; S6:3–26]

The committed technical package contains **no memory body, identifier, digest, citation, relation or existence signal**; pending candidates, private journals, authorization receipts and revocable projections are excluded too. Memory metadata and indirect influence fall within D10. A text-only allowlist cannot establish this boundary. Review the entire package and its derivation. Every committed fact must regenerate from Git, sanitized CI evidence or an explicitly pinned Track projection, never from the Engram memory journal. [S1 §4.3; S4 findings 1 and 8]

Memory-to-snapshot citations live only on the memory side or in an authorized runtime assembly, with no reciprocal committed reference. Eligibility loss invalidates that assembly; an old technical snapshot cannot restore excluded memory information. Any distinct durable-publication contract for memory references requires its own gr-conductor specification and qualification. [S4 finding 1; M1 M10]

```mermaid
flowchart LR
  S[Pinned Git sources] --> E[CI and architecture extraction]
  O[Sanitized immutable CI observations] --> T[Versioned timing reference]
  E --> K[Committed typed technical package]
  T --> K
  R[Track journal] --> X[Read-only pinned fragment]
  K --> P[Planning skill and conductor]
  X --> P
  Q[Current policy and capacity] --> P
  P --> L[Plan, knowledge lock and prediction]
  L --> A[Actual qualification evidence]
  A --> O
  A --> C[Cited lesson candidate]
  C --> M[Host policy and canonical memory journal]
  M --> F[Authorized eligible current envelopes]
  F --> G[Controlled runtime graph assembly]
  K --> G
  X --> G
  G --> V[DS semantic references and view occurrences]
```

Read the committed package at the branch base, validate and predict, then compare actual outcomes. Publish revised technical references through the source/generator review loop. Submit only bounded, reusable lessons through memory admission: for example, an integration underestimated consumer qualification and a shared publication window, with immutable evidence and a scoped revised rule. Avoid creating one memory per job execution; arithmetic always resolves to the pinned numerical reference. [S1 §4.4; S2:241–247]

## 6. Conductor and planning-skill consumption

### 6.1 Read-only prediction contract

Inputs are explicit: cumulative candidate changes and attested candidate/base/tested revisions; graph/timing manifest; current Track cursor, blockers and decisions; integration policy; runner/resource limits; writer, publication and environment constraints. Resolve the dependency graph, not lockfile text alone. Missing capacity yields an unconstrained scenario, never a start-time commitment. [S2:192–210]

```text
predict(changes, revisions, knowledgeManifest, track, policy, capacity) -> {
  affectedComponents, selectedJobs, executionPredecessors,
  criticalPath, gateDelay, releaseDelay, runnerWork,
  llm: { groups, files, decision, proof },
  status: applicable | conditional-historical | incomplete,
  knownSubtotal, unknowns, support, uncertaintyMethod,
  phases: [{ id, startEvent, endEvent, interval }],
  resourceAssumptions, policyDigest, timingRevision, evidenceHashes,
  proposedOrder, alternatives, rationale
}
```

Expand the actual union of changes through typed consumer/contract/build relations, accounting for strongly connected architecture components, required suites, all matrix variants, artifact prerequisites and publish/deploy gates. Compatibility must be established from declarations/schemas/consumer fixtures, never a PR label. Unknown parsing, dynamic entry or lineage conservatively expands required execution. Inference or a missing timing observation cannot remove a required check. [S1:128–133; S2:194]

Affected LLM files run completely and block, under the inherited strict policy. LLM impact and compatibility are separate classifications. Reuse earns zero credit until the complete authenticated-receipt path is qualified for actual inputs, suites, dependency artifacts, runtime and provider/model settings. Absent, expired, partial or PR-controlled evidence requires execution. Matching timing fingerprints or graphs are not transferable acceptance. [S1:132–133; S2:216]

For a fixed-duration scenario with unlimited resources, compute a lower bound:

```text
finish(v) = duration(v) + max(finish(u) for u in executionPredecessors(v))
gateDelayLowerBound = finish(requiredGate)
runnerWork = sum(duration(v) for allocated execution nodes v)
```

Use an empty predecessor maximum of zero. Unknown durations keep named symbolic terms and force `incomplete`, even if a known subtotal is displayed. Matrix work sums variants; completion follows their scheduled finishes. Steps explain whole-job cost and must not be counted twice. [S2:196–204]

Then schedule ready work under runner classes/counts, `max-parallel`, concurrency/cancellation groups, provider limits, environment locks and shared-writer windows. Preserve functional artifact, qualification/release and exclusive-writer precedences as distinct constraints. Compare valid alternatives with stable tie-breakers under the selected objective and a pinned policy. Start with a deterministic list scheduler; more complex search needs replay evidence of benefit. [S2:206–210]

Separate queue and service time; historical lifecycle calibrates the result and is not added on top of simulated queues. Use compatible run-block resampling or explicit correlated scenarios when samples share conditions. Per-job p90/p95 values never establish a plan-tail percentile. The four-branch orchestration cap is not runner capacity. [S2:206, 220]

### 6.2 Train invalidation and phase-matched steering

Each candidate prefix is a newly tested state. Recompute its combined closure and price; standalone PR durations are not additive. Failure, reorder, base advance or conflict resolution invalidates affected downstream predictions and candidates. Artifact consumers wait for the required producer tuple/receipt; independent work may overlap within resource and writer limits. [S2:212–214]

Forecast implementation, review/approval, CI execution and publication propagation separately. Timing steering is allowed only for a named phase with explicit start/end events and a matching measured distribution or explicitly modelled prediction interval. Track item age cannot be compared to a CI job percentile. With no comparable interval, retain existing activity-only steering. K0 must define those events; their instrumentation is not assumed. Mandatory cases: implementation in progress produces no CI timing trigger; executing CI uses its own interval; an unknown tail produces no timing trigger. [S1:142; S4 finding 5]

Preserve the existing urgency ladder and dependency/owner waits before timing-based ranking. Within eligible work, compare critical-path contribution, batching and resource-constrained waves. Missing required results never mean green. Any separate daily-train rollout keeps its own tuple-freeze, attribution and rollback protocol; it is not an implied activation here. [S1:108, 135–151; S4 finding 3]

### 6.3 Source planning-skill change and Track joins

Implement the change in h2a's source `packages/h2a/skills/harness/plan/SKILL.md`, then distribute/install normally. The installed plugin cache is not an authoring surface. Keep the strict checkbox template, scope boundaries, feedback loop and wave cap; harness owns the plan artifact and Track owns realization. [S2:220–233; H1]

1. Resolve exact repo/manifest identity, schema, digests, applicability and missing inputs.
2. Read Track items, decisions and blockers with their original IDs and ownership.
3. Derive each lot's affected closure and functional, writer, qualification and publication predecessors.
4. Compare integration alternatives against an unoptimized reference under explicit objective/capacity assumptions; list all unknowns.
5. Emit normal `BRANCH.md` checkboxes plus the knowledge lock and prediction artifact; attach gate/evidence and measurement obligations to each lot.
6. Refresh remaining work after relevant changes, retain prior predictions, reconcile actuals and propose bounded cited lessons.

No package produces a useful untimed plan with `timing: unknown` and a bounded measurement task. Historical-only inputs follow `conditional-historical` restrictions. Optional memory unavailability never prevents direct technical-package reads. Existing h2a discovery, ownership election and launch recommendations stay in place; the new consumer belongs in planning and launch packets. [S2:231–233]

Reuse `track export-graph` read-only. Parent `IMPLEMENTS` links do not establish scheduling precedence. Preserve Track IDs through the identity adapter; repository joins live in the plan/knowledge adapter, not event edits. Pin exporter version and source-derived observation timestamp, distinguish its source hash/cursor from the artifact-byte SHA-256, and avoid time-varying exports over unchanged inputs. [S2:235–237]

Track MCP remains read-only; its designated CLI writer handles authorized imports and transitions. Keep this study under the existing WP9 item, with one owner and explicit dependencies for cross-owner delivery. Do not restructure the backlog or duplicate status. Future merge/closure preserves structural event containment and refreshed acceptance, then rereads after consolidation; knowledge refresh never repairs Track implicitly. [S2:218, 239]

## 7. Qualified Engram seam

Keep the six frozen memory operations: search, exact get, capture, request admission, withdraw and forget. Capture is pending, not admitted; candidate withdrawal differs from forgetting by `tombstone`. The host provides trusted scope, authorization, invocation provenance and admission policy. `scope_ref` is opaque and host-interpreted; a repository name supplies no authorization. Filter before ranking or graph expansion. [S5; S6:8–10, 22–25; M1]

The repository adapter submits a bounded cited lesson through existing DTOs and the qualified host's idempotency contract. Search discovers lessons; exact get verifies known identity, current eligibility and source digests. Deterministic arithmetic and old-plan reproduction use immutable Git/CI/Track artifacts; current-only memory tools do not reconstruct arbitrary historical recall. Verified authenticity does not make a sample of one statistically strong. [S2:243–247]

Only authorized, eligible `accepted_current` envelopes with `projection_eligible === true` enter runtime projection. Envelopes/citation references/metadata are bounded to 52,428,800 raw bytes with deterministic omissions, freshness and invalidation; canonical bodies/history do not enter the graph. Reuse and qualify the existing `memory:` / `memory_about` seam. Authorize the view's audience before export; revocation, expiry, supersession and forgetting invalidate affected views. Shared live-Git citation resolution remains unverified. [S2:249; M1 M10; M2]

Engram option B is already selected. Source `0.20.0` and the memory-tools facade do not prove published-package, installed-host or activation readiness. Preserve the existing L4-candidate → L5-qualification → L4-exit chain and voluntary host activation. No bespoke endpoint, retired shadow protocol, extra CI-knowledge release gate or federation of h2a/Sentropic stores follows from this study. [S2:251; M1 M14]

Handoff to gr-conductor: valid reference/lesson, stale reference, denied scope and superseded/forgotten memory fixtures; their identities and memory-side citations; intended host/purpose; expected admission/read/projection behavior; exact qualified release/host prerequisites. Also prove source-digest mismatch rejection, denied-audience export refusal, pending/admitted separation, forgetting invalidation and that rebuilding an old technical snapshot restores no excluded memory metadata. Audit the committed package and derivation, not only text fields. [S2:253; S4 finding 1]

gr-conductor owns Engram conformity/readiness, the repository conductor owns technical facts/refresh, the host owner owns identity/scope/admission, and DS maintainers review profile/mapping. Any required Engram change follows the existing specification circuit (spec author Muse Wonder, review Astra, owner only for real decisions). An optional closed-DTO field needs a dated EVOL amendment and changelog; required or semantic changes need a new versioned DTO. Neither graph import nor rebuilding may capture, admit, mutate or resurrect memory. [S5:6; S6:23–26]

## 8. Delivery lots, acceptance and risks

These proposed implementation lots consolidate the adopted mapping; none is completed by this documentation branch. Each owning branch must use scoped, atomic commits and a template-based plan with concrete file-level verification. Keep the current WP9 ownership; record actual cross-owner outcomes through the designated tracking flow. [S2:285–299; S3 row 55 and final treatments]

| Lot | Accountable owner and deliverable | Dependencies | Observable exit | Rollback boundary |
|---|---|---|---|---|
| K0 — Consumer contract | Repository conductor with h2a, DS and gr-conductor: record distinctions, stable identity/profile mapping, phase events/intervals, source pins, owners and fixtures | Approved study; material owner choices only where needed | One contract and seam package; no conflicting authority or assumed host qualification; attributes and phase events explicitly defined | Revise the draft contract before consumers activate. |
| K1 — Measurement reference | Sentropic CI owner: collector/normalizer, schemas, compact timing data and reproducible historic import | K0 | Seed statistics reproduce with original quantiles; fixtures cover attempts, censoring, empty modes, sample/day/gate minima, absent usage and regime splits; changed samples change digest, identical inputs do not | Disable reference publication; keep evidence and an untimed plan. |
| K2 — Typed subgraphs and views | Repository tooling owner with DS/Graphify review: profiles, CI/architecture extraction, explicit adapters and view projection | K0; parallel to K1 on disjoint files | Pinned source counts, cross-domain relations, units/references, anchors and relation/incidence conservation pass; workflow/Make/Docker/import/artifact/deploy/dynamic fixtures covered; view changes preserve semantics | Disable adapter/rendering/generation gate; preserve reviewable technical history. |
| K3 — Deterministic prediction | Harness/planning implementation owner: closure, timing lookup, resource-constrained list scheduler and immutable prediction artifact | K1 + K2 | Serial/parallel/matrix/shared-writer/blocked/base-change/unknown fixtures pass; replay the 554 valid diffs with every closure divergence explained and comparable cohorts; no missing check earns savings | Disable recommendations; retain full current qualification and dependency planning. |
| K4 — Skill and conductor adoption | h2a harness owner with repository conductor: source skill, launch packets, knowledge lock and replanning | K3 | Sample plan/train reproduce pins and gates; missing reference yields untimed plan; changed inputs create new prediction; the three phase-steering cases pass; normal distribution path used | Revert the source skill consumer and return to qualitative ordering. |
| K5 — Engram seam | gr-conductor, qualified host owner and repository adapter owner: cited lesson submission, admitted lookup and controlled runtime assembly | K0, stable K1/K2 identities, existing host/transport qualification chain | Exact-candidate valid/stale/denied/pending/superseded/forgotten fixtures pass; D3/D10 package/derivation audit, denied-audience refusal and old-snapshot rebuild test pass; no closed DTO drift | Disable lesson adapter/runtime join; technical files and canonical journal remain independent. |
| K6 — Pilot and operations | Repository conductor and CI operations: collection/publication cadence, drift attribution, actual-versus-predicted history and merge regeneration | K4; K5 additionally required for hybrid completion | Shadow baseline/candidate comparison demonstrates prediction quality, reproducibility, useful scheduling and preserved current coverage; refresh idempotence, Track containment and fresh acceptance proven | Disable train optimization; retain full qualification, technical reference and evidence. |

Critical path: **K0 → (K1, K2) → K3 → K4 → K6**. Prepare K5 alongside it, subject to its host prerequisites. The Git pilot does not close the hybrid target. Independent CI-optimization lots and S1/S2/S3 activation criteria do not gate this program; no new skip-check policy is required. [S4 finding 3]

Acceptance evidence must show reproducibility of seed statistics and manifests; a Git/CI/Track source for every committed fact; lossless semantic/adapter/view mappings; applicability and phase-steering fixtures; useful scheduling comparisons on comparable observations; and no loss of required checks. For K5, separately prove canonical-journal-only memory authority and audience/lifecycle enforcement. A successful technical pilot alone proves neither host readiness nor hybrid completion.

Pilot metrics: prediction error by cohort, time to required green, time to publication where relevant, runner work, cancelled/repeated work, missing-reference rate and refresh delay. Report unknown money/provider/seat costs. Existing five-minute targets and a 10% p95 regression budget are pinned scenario inputs, not achieved outcomes. Do not claim production savings or a measured 95% success rate before qualification. [S1 §2.5; S2:299]

Remaining risks and bounded follow-up:

- Engram per-repository canonical storage location, deployed host capability tuple, shared live-Git citation resolution and joint re-acceptance of D3/D10 restoration remain unverified in the cited handoff; resolve through K0/K5 with gr-conductor/host owners, without blocking Git-only reads. [S6:8, 18, 26; S2:249–253]
- Profile attribute sets and identity/anchor mapping require DS review in K0/K2; the prototype's UI package version does not attest diagram-core contract adoption.
- Missing lanes and unknown timing terms require explicit measurement/coverage work; this study does not repair job performance. Historical LLM-gap populations (335 affected-gap diffs and 486 general-debt diffs, overlapping) require boundary-specific re-audit before any separate CI activation. [S1 §9]
- Window updates can churn committed files; publish at declared cadence with movement thresholds and semantic diffs. Missing raw evidence limits reproduction. Concrete retention costs beyond policy belong with operations/owner once evidenced.

## 9. Questions ouvertes au propriétaire

**Statut : aucune sélection enregistrée.** Le commit des sous-graphes est déjà demandé et l'option Engram B est déjà choisie dans son programme. Les chemins, unités, identités, contrôles d'intégrité, règles d'invalidation et paramètres réversibles relèvent des responsables techniques ; ils restent visibles dans le plan. La rédaction réversible peut avancer sans attendre D1. Les dossiers ci-dessous remplacent intégralement les anciens votes. [S2:301–321; S4 findings 3, 7 and 8]

### D1

**Jusqu'où financer et coordonner la capitalisation dans cette livraison ?** Le choix porte sur le périmètre interéquipes et la responsabilité durable du raccord.

| Option | Résultat | Conséquences et coût | Quand la préférer |
|---|---|---|---|
| A — Paquet Git et planificateur d'abord ; raccord Engram dans une suite séparée | Références mesurées, graphes typés, plans reproductibles et leçons conservées dans le dépôt | Livraison indépendante des hôtes mémoire ; coordination immédiate réduite. Admission/rappel Engram et financement du raccord restent pour la suite. | La priorité est l'intégration rapide, sans responsable disponible pour le raccord mémoire. |
| B — Cible hybride dans le programme, livrée par étapes | Même première livraison, puis leçons admises dans Engram et références filtrées dans le graphe d'exécution | Coordination gr-conductor/hôte et maintien d'un adaptateur vérifié. Le bénéfice mémoire attend sa qualification ; le premier pilote Git reste livrable avant. | La réutilisation entre sessions est attendue et une responsabilité durable peut être attribuée. |
| C — Engram comme service principal des références numériques | Cycle de vie centralisé, avec exports typés commités | Contrat numérique supplémentaire, coordination des exports, dépendance au service ; effort/délai non mesurés. Le service complet n'est pas démontré par les contrats inspectés. | Un besoin produit plus large et déjà financé justifie ce service central. |

Recommandation : **B**, avec K1–K4 utilisables avant K5. Son principal coût est une responsabilité d'adaptation durable pour une utilité mémoire encore à mesurer. **A** devient préférable si personne ne peut la porter ou si le pilote ne démontre pas l'intérêt du rappel. **C** demande une justification produit supplémentaire et un contrat distinct. Les coûts sont exprimés en lots/dépendances ; aucun budget financier ou délai humain n'est mesuré. Choix attendu : A/B/C et, pour B/C, attribution du responsable du raccord. Aucun choix ne modifie le calendrier Engram déjà accepté ni les contraintes D3/D10.

### D2

**Quelle priorité quand accélérer le train consomme davantage de ressources ?** À ouvrir seulement si la politique existante ne tranche pas le conflit. Les seuils approuvés restent applicables ; le pilote peut comparer les options sans augmenter la capacité ni transformer une simulation en engagement.

| Option | Bénéfice recherché | Conséquence |
|---|---|---|
| A — Délai minimal dans les plafonds autorisés | Réduire l'attente jusqu'au résultat requis grâce au parallélisme disponible | Davantage de travail simultané et de calcul potentiellement perdu après invalidation ; expliciter plafonds et priorité des trains. |
| B — Moins de travail total, sous une limite d'attente | Regrouper les changements compatibles et réduire les validations répétées | Certains changements attendent ; une invalidation peut affecter un groupe plus large. Aucun contrôle requis n'est supprimé. |
| C — Capacité actuelle, priorité au chemin bloquant | Améliorer l'ordre et le chevauchement sans nouveau budget de capacité | Gains de délai potentiellement plus faibles ; les contraintes de runner/publication peuvent rester dominantes. |

Recommandation pour le premier pilote : **C**, pour mesurer la valeur de l'information avant de changer les budgets. Un besoin explicite de délai incompatible avec les ressources actuelles peut renverser cette recommandation. Choix attendu seulement si nécessaire : priorité A/B/C et plafonds ou délais applicables. Ce choix n'autorise ni fusion ni publication automatisée.

## 10. Review disposition and source register

Round two approved the paper design with one non-blocking documentation note (R2-P3). It is one review leg, not a consensus or a cross-owner freeze. This repository version applies that note; the source snapshots below remain historical evidence, and this document is the single operative drafting contract. [S4]

| Retained historical material | Operative replacement here |
|---|---|
| D-K1–D-K3 votes and D-K4 autonomy/skip-check conflation | Only current French [D1](#d1) and conditional [D2](#d2); technical conventions in §§2–4; current qualification preserved in §8. |
| F1 wording requiring D1 before lot renumbering | Unified K0–K6 already defined in §8; reversible drafting proceeds. |
| Stale price presented as a completion bound | Exactly three applicability statuses and permitted uses in §2.3. |
| SvelteFlow scene as schema; three profiles; flat graph without adapters | Semantic/View documents, one profile and relation-preserving adapters in §4. |
| Committed memory references or Engram journal as a regenerating authority for technical facts | Git/CI/Track-only technical provenance in §5; memory-side citations and controlled runtime projection in §7. |
| Old decision offsets | Current source D1 starts at S2:303 and D2 at S2:313; the repository copies above are directly linked from the branch plan. |

S0–S6 below are archived local input locators under `.tmp/ci-knowledge-study/` in the source repository; they are not portable runtime dependencies or files introduced by this PR. Their SHA-256 digests were recomputed during drafting. The operative requirements and French dossiers are carried in full here so readers need no scratch checkout to follow the plan.

| ID | Archived file | SHA-256 |
|---|---|---|
| S0 | `OWNER-REQUEST.md` | `4b5a35dad17de2a0ff9b681c9d7dfd6e4ab0c6b39312bedd7043ec208927f72f` |
| S1 | `study.md` | `f06f608f5e351cb54f5aded1e074747111e05f00eac9c90a9d2ec1c6addf5002` |
| S2 | `study-astra.md` | `5cbc77162b63ae0526db10ae611f540d6882d5b97bd8078bc2e853195f19bcfc` |
| S3 | `reconciliation.md` | `7ebe448fa9e8ed16b7302de2ec33cafa30db02116b3b70f98bbfd12a9bf7192a` |
| S4 | `review-astra-r2.md` | `940707fb06def101e66a575b7099e7d6346f94cecb3a2fe2017fc3f1a9ae87cb` |
| S5 | `gr-conductor-input.md` | `d4dbdd985361e43b6d09d08b515c131756a3df9825615762bff0a89d1bfe8529` |
| S6 | `gr-conductor-engram-facts-sol.out` | `d43a602c829d25480a7f087f5a10e0e2f6ad0e14af6eea69be5e928b04c63930` |

Additional source identities from the approved evidence record (source inspection does not imply current deployment qualification):

- **E1** — `.tmp/focus-ci-efficiency-kit/evidence/contract-inputs.json`, freshly hashed `e9255c126c526fb63df510d55a0bd431f400dd7723f110141c7948f37a9fba72`; its `scripts/contract-evidence.mjs:11–22, 26–77, 108–178`, `ci-optimization-implementation-plan.md:16–46` and `strategy-study-astra.md` document populations, prices and scenarios. Source revision and Lot 1 pins are in §1.
- **E2** — `.tmp/ci-efficiency/graph/analyze.mjs:105, 146, 171, 185`, `graph/replay.mjs:9, 55` and `evidence/normalize.jq:5`; these are historical extractor/normalizer inputs, not new repository executables.
- **E3** — `.tmp/focus-ci-efficiency-kit/evidence/lot1-reference/scripts/ci/measure-runs.mjs:7, 38, 59–71, 87`, pinned through the separate Lot 1 revision; gap observations concern that inspected snapshot.
- **G1** — Graphify `8f19554cea3a4397fd66a90c7e9fd5ea54c81626`: `src/graph.ts:13, 33`, `src/validate.ts:21, 42`, `src/types.ts:118`. The later gr-conductor facts independently name `HEAD=d2acfc43` / `origin/main=a88375f0`; do not conflate them.
- **H1** — h2a `0d6b2eaf5884834ca5a7498477c6efdfba24a3de`: `packages/h2a/skills/harness/plan/SKILL.md:12–35`, `packages/track/src/graph-export.ts:101, 201, 267`, `packages/track/src/cli/index.ts:1273`. Source Track `0.91.0`, observed exporter `0.98.0` and plugin cache `0.98.7` are distinct evidence versions; the observed 234-node/265-edge export is not a current acceptance count.
- **M1** — Engram normative `SPEC-memory-mcp-v3.2.md`, archived at `graphify/.graphify/scratch/design/memory-mcp/`; recorded SHA-256 `18c697c1cd91287fd9f814c059910ffb4b39ddb1be46af547f384c7d912177b2`. M10 at line 1368 governs metadata/indirect influence; closing M14 at 1706 supersedes the opening's undecided wording. Six-tool/host contracts begin at lines 136–153; publication chain at 1545.
- **M2** — Engram [memory projection](https://github.com/rhanka/engram/blob/ceb33dae4570ca20c4fbae2a69b065919de17a25/src/graph-memory-projection.ts#L17) and [memory tools](https://github.com/rhanka/engram/blob/ceb33dae4570ca20c4fbae2a69b065919de17a25/src/memory-tools/index.ts#L1), source `ceb33dae4570ca20c4fbae2a69b065919de17a25`, package `0.20.0`; the deployed/qualified host tuple remains K5 evidence.
- **DS** — Immutable diagram-core source links in §4 pin `25c0f3d33c258fc2b906a4b85219ffce5f67eccc`; the older local DS checkout and prototype Svelte packages establish neither schema absence nor contract qualification at that revision.

Documentation verification checks quote fidelity, source digests, active-vs-historical requirements, current D1/D2 anchors, branch scope and atomic commit sizes. Runtime schemas, prediction correctness, host behavior and pilot performance remain the observable K0–K6 gates above.
