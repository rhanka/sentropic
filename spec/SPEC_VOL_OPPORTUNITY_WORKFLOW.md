# SPEC_VOL — Opportunity Workflow Adaptation

Status: Raw product intent (2026-03-17). Needs spec phase before implementation.

## A. Prompt use-case / opportunites
- Workflow for opportunity workspaces must have distinct identifier (not "AI use-case generation workflow").
- Prompt must be neutral relative to AI. AI may appear only if subject lends itself.
- Applies to general opportunity management: client acquisition, internal projects, product placement.

## B. Organisation(s) / opportunite
- An opportunity should reference multiple organisations.
- The `opportunity_list` task must produce **pairs (initiative, organisation)** — e.g. "architecture cloud Azure, BRP", "4 squads agiles, Bombardier". The organisations are derived from the prompt context, not pre-selected.
- After listing pairs, `create_organizations` creates the organisations that don't already exist (dedup against existing orgs).
- Then `opportunity_detail` generates each initiative linked to its organisation(s) via `organizationIds`.
- **UI (deferred)**: multi-select organisation in folder creation form + prompt surface for batch org creation.
- This multi-org option should also be available for AI use-case generation.

## B'. Batch organisation generation
- Agent-driven batch creation from a prompt (e.g. "top 10 pharma companies in Montreal").
- **UI (deferred)**: dedicated prompt surface or chat tool to trigger batch org creation.
- Could be a separate branch.

## C. Matrix / workflow opportunite
- Matrix adaptable per organisation (reuse org matrix) or per opportunity prompt.
- Should also apply to AI use-case matrices.

## D. Prompt matrix / opportunite
- Matrix adaptation must allow customising the axes themselves (not just scales).

## E. Template matrix / opportunite
- Default matrix must be generic (not AI-oriented). Neutral barrier/friction dimension.

## F. Initiative data fields
- "Data sources" and "Data" not applicable to all. Keep optional or replace with "Technology".
- Prompts must frame problems/solutions relative to opportunity analysis.
