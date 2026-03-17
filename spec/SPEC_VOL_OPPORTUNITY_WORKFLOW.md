# SPEC_VOL — Opportunity Workflow Adaptation

Status: Raw product intent (2026-03-17). Needs spec phase before implementation.

## A. Prompt use-case / opportunites
- Workflow for opportunity workspaces must have distinct identifier (not "AI use-case generation workflow").
- Prompt must be neutral relative to AI. AI may appear only if subject lends itself.
- Applies to general opportunity management: client acquisition, internal projects, product placement.

## B. Organisation(s) / opportunite
- An opportunity should reference multiple organisations.
- Workflow option: auto-create organisations (using org generation prompt) before creating use cases.
- Prompt must retrieve existing orgs to avoid duplicates and map initiatives to orgs.
- This multi-org option should also be available for AI use-case generation.

## B'. Batch organisation generation
- Agent-driven batch creation from a prompt (e.g. "top 10 pharma companies in Montreal").
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
