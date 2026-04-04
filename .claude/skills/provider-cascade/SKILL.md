---
name: provider-cascade
description: Verify all 5 LLM providers when modifying provider or LLM runtime logic
paths: "api/src/services/llm-runtime/**,api/src/services/providers/**"
allowed-tools: Read Bash Grep Glob
---

## Provider Cascade Check

1. Identify what changed (message format, tool definition, response parsing, streaming)
2. Read all 5 provider files:
   - `api/src/services/providers/openai-provider.ts`
   - `api/src/services/providers/gemini-provider.ts`
   - `api/src/services/providers/claude-provider.ts`
   - `api/src/services/providers/mistral-provider.ts`
   - `api/src/services/providers/cohere-provider.ts`
3. For each provider, verify equivalent logic exists for the change
4. Check `llm-runtime/index.ts` for dispatch changes
5. Run: `make test-api-ai ENV=test-$BRANCH`
