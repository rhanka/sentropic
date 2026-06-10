---
name: brainstorm
description: Use before any creative/design work (a feature, a package, an evolution) — explores intent and design via the spec-ladder with multi-peer adversarial review BEFORE implementation.
---

# harness/brainstorm

Native sentropic ideation. Stronger than a single-pass brainstorm: it climbs the **spec-ladder** and
gates each design step with **≥2 independent adversarial peers** and **batched** owner decisions.

Open the act: `harness brainstorm "<topic>" [--peers <n>] [--ladder study|vol|evol]` (records a WorkEvent).

## The spec-ladder

Pick the rung that matches the uncertainty, write the artifact under `spec/`:

- **STUDY** (`SPEC_STUDY_<TOPIC>.md`) — open question, options, trade-offs. No commitment yet.
- **VOL** (volition) — the chosen direction + rationale, still reversible.
- **EVOL** (`SPEC_EVOL_<TOPIC>.md`) — the committed design with numbered decisions (D1…Dn) ready to plan.

Don't skip rungs for a genuinely open problem; don't over-ceremony a reversible one.

## Multi-peer adversarial review (the differentiator)

Before presenting decisions, get **≥2 independent reviews from distinct angles** (e.g. Opus 4.8 + Codex
5.5-xhigh, or distinct lenses: correctness / risk / user-value). Reconcile divergences explicitly — a
lone reviewer rationalises; a panel surfaces failure modes. Reversible calls: decide solo. Blocking /
irreversible calls: escalate.

## Batched decisions

Present owner decisions as a **clean full dossier (never a delta)**, THEN ask in **lots of ≤4** questions.
Each question carries its own context inline (source + stakes + consequence) — an id like "D5" alone
carries no meaning. Once answered, treat all answers final; do re-examination in prose, don't re-poll.

## Done

A ladder artifact exists, peers reconciled, decisions captured. Hand off to `harness/plan` to turn the
EVOL decisions into BRANCH.md lots.
