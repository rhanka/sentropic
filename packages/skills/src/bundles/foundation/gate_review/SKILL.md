---
name: gate_review
description: Review initiative gate criteria for a maturity-stage transition in AI-priorities and opportunity workspaces.
version: 0.1.0
category: analysis
contextFilter:
  workspaceTypes: [neutral, ai-priorities, opportunity]
tools:
  - name: gate_review
    description: Review gate criteria for an initiative maturity-stage transition.
    inputSchema:
      type: object
      properties:
        initiativeId:
          type: string
          description: Initiative ID.
        targetStage:
          type: string
          description: Target maturity stage (for example G0, G2, G5, or G7).
      required: [initiativeId, targetStage]
---

# Gate review skill

The `gate_review` skill evaluates whether an initiative is ready to move to a
target maturity stage based on the configured workspace gate criteria. Use it
when a caller wants blockers, warnings, or readiness feedback before a stage
transition.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
