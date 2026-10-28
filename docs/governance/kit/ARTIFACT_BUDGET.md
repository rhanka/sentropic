# Dossier artifact budget

The diagram engine consumes the rendered dossier's scenes, prepared folds/plans,
projection routes, summary geometry and translation dictionary. It does not import
the governance corpus. The full governance application binds its own tables in
`src/governance-input.js`; a smaller consumer imports the reusable modules directly
and installs its dictionary with `configureTranslations` before mounting.

`projectGovernanceScene` fails when a required projection is missing. Prepared
folds match exact geometry and relation signatures. Uncovered folds retain bounded
runtime caching, keyed by scene, language, routing version and geometry. Changing
the routing implementation requires changing `routingVersion`. The small fixture
prepares every fold combination (12 states across its two scenes); preparation
rejects more than eight groups instead of expanding an unbounded state space.

Run from the repository root:

```sh
make check-artifact-budget ENV=test-artifact-weight
make down ENV=test-artifact-weight
```

On a shared host, wrap each Docker target and cleanup in the machine's agreed
`flock` lock. `build-artifact-budget` and `probe-artifact-budget` can be run
separately to release the lock between build and browser qualification. Containers
use `--rm`; dependencies are installed inside Docker and removed on exit. Builds
write only to the kit's ignored `.cache/artifact-weight/` scratch directories.
No tracked source or architecture hash is rewritten.

## Profiles and counting

| Metric | Typical dossier | Full bilingual governance |
|---|---:|---:|
| Portable HTML | 409600 B | 5200000 B |
| Hosted initial closure | 409600 B | 5200000 B |
| Initial executable JS | 307200 B | 5120000 B |
| Each optional JS chunk | 131072 B | 131072 B |
| Full hosted release | 524288 B | 5200000 B |

The typical reference contains two diagrams (3/6 nodes, 3/2 groups), two questions,
six options, 24 inventory rows, eight gaps, themes, controls and downloads. Its
fixtures preserve the approved harness r5 inputs, compacted without value changes.
The separate governance profile preserves the existing large bilingual dossier,
33 navigation needs and prepared routing tables. Its explicit ceiling cannot relax
the typical gate; both profiles are reported and enforced on every budget run.
Governance measured 4936831 B portable / 4874332 B JS after the CSP addition.
Its ceilings allow approximately 5% growth for runtime/toolchain changes; they
must be reviewed against fresh measurements rather than raised automatically.

The Vite manifest determines static and dynamic closures. A cold browser probe adds
every request through the first usable typical dossier to the initial closure,
including startup data fetches. Executable inline scripts count toward the JS
limit in both variants; JSON and plain-text notices count toward HTML bytes.
Files count once per deployed path; repeated inline
bytes count each time. Missing assets, unreferenced deployed payloads, external
startup dependencies and runtime source maps fail. Every file reports raw, gzip,
Brotli and SHA-256; Rollup module attribution is explicitly before final
minification. Module compressed sizes are not additive.

The portable builder inserts CSP `connect-src 'none'`. Both the builder and the
budget measurement assert that policy, inline resources and no dynamic `import()`
calls, including `assets/` paths and sibling chunks. The browser opens the file offline, exercises all folds on desktop
and mobile in both themes, zoom, choices, table totals and JSON downloads.

Reports live at `.cache/artifact-weight/<profile>/artifact-size-report.{json,md}`.
`validate-artifacts` uploads them with browser/startup/geometry/routing receipts.
The filter includes `docs/governance/kit/**`, DS component/theme sources and the
existing artifacts package/template paths. Publication filters are unchanged.
Negative tests cover corpus reimport, startup-fetch excess, deferred chunk excess,
static-import sums, missing files and unused deployed data. The baseline build
deliberately retains the governance corpus and must fail the typical JS budget.

`check-governance-equivalence.mjs` executes both the pinned main renderer
(`5016fa36a9da25d22972ae092d13bd4357e65e58`) and the current renderer with identical
dependencies (lockfile equality is required). It compares exact generated SVG
hashes/byte counts and canonical groups/nodes/edges hashes, in FR and EN, for
every figure, navigation highlight, prepared fold and overview routing plan.
The per-case receipt is `.cache/artifact-weight/governance-equivalence.json`,
uploaded in CI. This directly compares figures/routes against main; the offline
browser probes additionally cover runtime integration in light and dark themes.

## Baseline and publication read cost

`fixtures/artifact-weight/baseline.json` pins inputs, lock/toolchain identities and
analysis provenance. `preserved-renders.json` records the independently measured
r4/r5 full, slim and Focus hashes. Preserved r5: 3708921 B HTML / 3669759 B JS;
preserved slim: 292520 B HTML / 253358 B JS. Focus: 357891 B, with renderer 0.98.7
and validator 0.5.0. Focus uses the same dossier through a different composition;
its exact bytes are a reference, not this renderer's rebuild acceptance.

Fresh reports record actual Node, Svelte, Vite, Rollup, minifier and DS versions,
input digests, commit and output hashes. Current Vite is 7.3.7; the preserved harness
used 7.3.6. Fresh baseline and typical builds use the same current renderer and lock.

The local qualification receipt is `fixtures/artifact-weight/qualification.json`;
its `codeCommit` identifies the qualified post-merge code ancestor. The subsequent
receipt-only commit records these outputs without changing the renderer:

| Metric | Fresh corpus baseline | Scoped dossier |
|---|---:|---:|
| Portable HTML | 3734180 B | 291943 B |
| Initial executable JS | 3691474 B | 249234 B |
| Agent read cost, portable | 3734180 B | 291943 B |

This removes 92.2% of portable bytes. Both fresh variants include the current
renderer, bounded fold preparation, CSP and exact font notices. Fourteen unit/negative
tests, 1758 geometry scenes, four typical offline configurations and four full
governance language/theme configurations passed; the cold startup closure is
291870 B. These receipts do not substitute for CI on a later commit.

Every report includes **agent read cost**: the bytes of every file a publishing
agent must read, portable and hosted separately. Inline JS/data is already counted
inside the HTML. This is non-gating. The Claude Artifact tool contract observed in
the approved review on 2026-10-27 states: “Files Claude did not write: Claude reads
the whole file before publishing it … If Claude cannot read the file, it does not
publish it.” This confirms the agent-publication constraint; no fixed code-read
byte threshold was documented. The 16 MiB rendered-file ceiling is a separate
platform limit, not this project's performance budget.

The report also estimates **coût de lecture agent ≈ 0,5 token par octet de JS minifié**
(h-cond, 2026-10-27): `round(inlineExecutableJs * 0.5)`, or 124617 tokens for the
typical fixture. This estimate is non-gating; base64 fonts/images are decoded for
inspection rather than read as source text.

The source anchors corrected by review P2-4 are the preserved harness
`ArchitectureFigure.svelte:6` (DS import) and `evidence/provenance.md:5` (requested
governance revision). The scratch `Measure.mk` reproduction rewrites its evidence
JSON; preserved receipts here do not imply a fresh browser execution.

## Qualification boundaries

The actual canvas/A2UI L1 DS 0.36.0 / dataviz-core chart template still needs its
own fixture. This lane changes no DS package, export or version and makes no L1
acceptance claim. Hosted manifest/ACL/CSP qualification and Claude multi-file
publication remain separate. Reusing a pinned runtime with `files: {artifact,
path}` is a candidate server-side reuse path to qualify, not an established
capability or a claim that its bytes disappear from a release.
