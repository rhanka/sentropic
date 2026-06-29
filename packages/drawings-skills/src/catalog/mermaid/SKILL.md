---
name: mermaid-generation
description: Generate valid Mermaid diagram source from a natural-language request, then write it into the canvas via the render_mermaid local tool.
---

# mermaid-generation

The mermaid entry of the `@sentropic/drawings-skills` catalog. A format module = **skill + tool + agent + canvas capabilities**.

## When to use
When the user asks (in chat) to create or modify a diagram and the active format is Mermaid.

## Generation contract (the skill)
- Output a **single valid Mermaid document** that starts with a diagram keyword
  (`flowchart`, `graph`, `sequenceDiagram`, `classDiagram`, `stateDiagram(-v2)`, `erDiagram`, `gantt`,
  `pie`, `journey`, `gitGraph`, `mindmap`, `timeline`, `quadrantChart`, `requirementDiagram`, `C4Context`, …).
- Prefer `flowchart TD` unless another type is clearly implied.
- **No markdown code fences, no prose.** Keep node ids short, stable, and meaningful — they anchor user annotations.
- Validation: `mermaidPrecheck` (cheap, sync keyword gate) then `mermaidParse` (real `mermaid.parse`, async) =
  `DrawingSkill.validate`.

## Tool (`render_mermaid`, execution: local)
`{ source: string }`. Advertised to the LLM by the server; **executed client-side** by the app-owned
local-tool bridge, which writes `source` into the canvas store and renders. Strip the app-only `execution`
field with `toFunctionToolDefinition()` before sending the schema to a provider (chat-core uses `parameters`).

## Agent
`createMermaidAgent({ generate })` — `generate` is the injected LLM call (API: llm-mesh + provider SDK).
Flow: generate → validate → retry once on invalid.

## Example
> "a simple login flow"
```
flowchart TD
  User[User] --> Login[Login]
  Login --> Auth{Auth ok?}
  Auth -- yes --> Home[Home]
  Auth -- no --> Login
```
