# cluster-mesh decision dossier — revision r14

Committed decision dossier for `cluster-mesh-shared-core`, revision `2026-09-05-r14`
(architectureHash `f5d525cfbaeb37f9ed9234f3c19eadd02ac26f9c6b460f47c5ce3692640d0c60`).

Source of truth authored in the standalone Focus decision kit
(`.tmp/focus-cluster-mesh-decision-kit/`, gitignored build tool); the durable artifacts
are committed here per owner directive D25 ("commit the dossiers with their revisions").

## Files
- `dossier.json` — the r14 decision dossier: 25 decisions (D1-D25), source lineage
  ledger r1→r14, embedded v1 specification snapshot. Native Focus decision-kit/v4 model.
- `owner-answers-r14.json` — owner answer set captured 2026-09-05T22:30:44Z from the kit:
  selected option, decisionStatus, per-decision owner notes, round-stamped remarks/responses.
- `raw-spec.md` — raw specification input consumed by the dossier.

## Status of the decisions
- **D1-D17**: ratified / owner-corrected / baseline / internal-conductor-gates — carried
  unchanged from the r10→r13 lineage (owner choices and round-stamped remarks preserved).
- **D18-D25**: `proposed-how` — the owner reviewed these and returned directions, not final
  ratifications. They require a further revision (r15) before decision.

## Owner directions carried into r15 (from owner-answers-r14 notes)
- **Single version, no v1/v2 split (D23=B):** nothing is deployed yet and v1 dev is not
  finished; the remaining design is planned as the continuation AFTER the 38 lots and yields
  one version. Drop v1/v2 framing.
- **Context Projection (D18=A) is an autonomous library** activatable three ways: a per-CLI
  hook (like rtk, for claude and others), optionally at the gateway (needs an evaluation),
  and as a hook inside Sentropic agentic workflows. The dossier must present the architecture,
  the context-projection capabilities, and a benchmark (rtk, other tools, and our proposal).
- **Library suite must be disentangled** and their call paths made explicit:
  Context Projection (rtk-equivalent), the GREYWALL-equivalent authority library, **graphify
  code** (code indexation for token economy) and **graphify memory** (context memory) — these
  are DISTINCT and were conflated; r15 must separate them and show how each is invoked.
- **D19 / D21 (context admission, terminal-free execution):** explain how others do it
  (rtk and equivalents; the CLIs; claude.ai / codex / chatgpt) and our proposed approach,
  with schemas and illustrations.
- **D20 (universal loop):** add schemas; clearly separate the agentic loop from session
  logging/observability and from context/memory optimizations, across execution modes
  (`h2a run claude` local CLI, same remote on k8s, remote-controlled via the app).
- **D22 (effect authority):** define PDP/PEP, present the GREYWALL principle and a comparison,
  add schemas; likely split into several questions, articulated with rtk, graphify memory and
  graphify code.
- **D24 (measurement = validation, not an integration gate):** accepted (A).
- **D25 (lineage archival):** accepted (A) — this commit.

No push / PR / merge without owner GO.
