---
name: history_analyze
description: Answer targeted questions over conversation history with evidence references.
version: 0.1.0
category: analysis
tools:
  - name: history_analyze
    description: Answer targeted questions over conversation history with evidence references.
    inputSchema:
      type: object
      properties:
        question:
          type: string
          description: Targeted question to answer from chat history.
        from_message_id:
          type: string
          description: Optional lower bound message id (inclusive).
        to_message_id:
          type: string
          description: Optional upper bound message id (inclusive).
        max_turns:
          type: integer
          minimum: 1
          maximum: 500
          description: Optional bound on scanned turns.
        target_tool_call_id:
          type: string
          description: Optional tool call id to focus on one specific oversized tool result path.
        target_tool_result_message_id:
          type: string
          description: Optional tool-result message id to focus the analysis scope.
        include_tool_results:
          type: boolean
          description: Include tool-result messages in analysis scope (default true).
        include_system_messages:
          type: boolean
          description: Include system messages in analysis scope (default false).
        max_words:
          type: integer
          minimum: 200
          maximum: 6000
          description: Optional answer bound in words.
      required: [question]
---

# History analyze skill

The `history_analyze` skill answers focused questions over prior conversation
turns with evidence references. Use it when the user asks what was decided,
what remains open, or what a prior tool result or message actually said.

Handlers are intentionally not bound in this package commit. Runtime execution
still routes through the legacy API tool service until BR-19 Lot 5 rebinds
chat-service to `SkillsToolRegistry`.
