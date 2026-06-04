---
name: solutions
description: Read solution records attached to opportunity workspaces and initiatives.
version: 0.1.0
category: object
contextFilter:
  workspaceTypes: [neutral, ai-priorities, opportunity]
tools:
  - name: solutions_list
    description: List solutions in the current workspace.
    inputSchema:
      type: object
      properties: {}
  - name: solution_get
    description: Read one solution by id.
    inputSchema:
      type: object
      properties:
        solutionId:
          type: string
      required: [solutionId]
---

# Solutions skill

The `solutions` skill exposes workspace-scoped solution object tools for
proposed approaches, technical solutions, and opportunity solution records.

Handlers are intentionally not bound until chat-service is rebound to
`SkillsToolRegistry`.
