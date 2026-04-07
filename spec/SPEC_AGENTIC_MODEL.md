# Agentic Model Specification

## 1. Agent Definition Structure

Agents are defined by `DefaultGenerationAgentDefinition` in `api/src/config/default-agents-types.ts`:

```ts
{
  key: string;           // Unique identifier (e.g. "usecase_list_agent")
  name: string;          // Human-readable display name
  description: string;   // Purpose description
  sourceLevel: "code";   // All current agents are code-defined
  config: {
    role: string;                    // Functional role identifier
    domain?: string;                 // "shared", "code", or omitted for domain-specific
    workflowKey?: string;            // Workflow this agent orchestrates
    promptId?: string;               // Default prompt identifier for LLM calls
    promptTemplate?: string;         // Inline prompt template with {{placeholders}}
    outputSchema?: Record;           // JSON Schema for structured LLM output
    baseMatrixId?: string;           // Matrix configuration ID (for matrix agents)
    customAxes?: boolean;            // Custom axes support flag (D)
    mergePromptTemplate?: string;    // Merge prompt for chunked analysis
    detailedSummaryPromptTemplate?: string; // Detailed summary prompt variant
  }
}
```

Agents are persisted in the `agent_definitions` table with workspace-scoped rows. The `config` field stores the full configuration as JSONB.

## 2. Agent Seed per Workspace Type

Agent catalogs are split across files and combined per workspace type in `api/src/config/default-agents.ts`:

| Workspace Type | Domain Agents | Shared Agents | Total |
|---------------|---------------|---------------|-------|
| ai-ideas | AI_IDEAS_AGENTS (6) | SHARED_AGENTS (7) | 13 |
| opportunity | OPPORTUNITY_AGENTS (6) | SHARED_AGENTS (7) | 13 |
| code | CODE_AGENTS (3) | SHARED_AGENTS (7) | 10 |
| neutral | (none) | (none) | 0 |

### Domain-Specific Agents

**ai-ideas** (`default-agents-ai-ideas.ts`):
- `generation_orchestrator` — lifecycle orchestration for AI use-case generation
- `matrix_generation_agent` — generates context-specific matrix descriptions for scoring
- `usecase_list_agent` — generates structured list of candidate use-cases
- `usecase_list_with_orgs_agent` — org-aware variant with organization matching
- `todo_projection_agent` — projects generated list to TODO runtime tracking
- `usecase_detail_agent` — generates detailed payload per use-case with scores
- `executive_synthesis_agent` — generates executive summary narrative

**opportunity** (`default-agents-opportunity.ts`):
- `opportunity_orchestrator` — lifecycle orchestration for opportunity identification
- `matrix_generation_agent` — opportunity-specific matrix (different axes: regulatory_compliance, resource_availability)
- `opportunity_list_agent` — generates structured opportunity list
- `opportunity_list_with_orgs_agent` — org-aware variant
- `todo_projection_agent` — TODO runtime projection
- `opportunity_detail_agent` — generates detailed payload per opportunity
- `executive_synthesis_agent` — executive summary for opportunities

**code** (`default-agents-code.ts`):
- `codebase_analyst` — scans codebase for patterns, dependencies, architecture
- `issue_triager` — triages and prioritizes issues
- `implementation_planner` — generates implementation plans

### Shared Agents

Available on all workspace types (`default-agents-shared.ts`):
- `generate_organization_agent` — generates/enriches organization profiles from company names
- `demand_analyst` — analyzes client demand and opportunity viability
- `solution_architect` — designs solution architecture
- `bid_writer` — prepares bid documents
- `gate_reviewer` — evaluates initiative maturity against gate criteria
- `comment_assistant` — generates structured proposals to resolve comment threads
- `history_analyzer` — targeted QA over chat history with chunked merge
- `document_summarizer` — extracts structured summaries from documents
- `document_analyzer` — analyzes documents per specific instruction with chunked merge

### Seed Mechanism

On workspace creation, `todoOrchestrationService.seedWorkflowsForType()`:
1. Looks up `WORKSPACE_TYPE_AGENT_SEEDS` for the workspace type.
2. Calls `seedAgentsForType()` which upserts agent definitions (insert if key not present, update config if `sourceLevel === "code"`).
3. Returns `agentIdsByKey` map (agent key -> agent definition ID).
4. Passes agent IDs to workflow seeding for task-to-agent linkage.

## 3. Runtime Agent Selection

Workflow tasks can declare `agentSelection` in their metadata for conditional agent routing at runtime.

```ts
agentSelection: {
  defaultAgentKey: "usecase_list_agent",
  rules: [
    {
      condition: anyOf(
        conditionEq("inputs.autoCreateOrganizations", true),
        conditionNotEmpty("orgContext.effectiveOrgIds"),
        conditionNotEmpty("orgContext.selectedOrgIds"),
      ),
      agentKey: "usecase_list_with_orgs_agent",
    },
  ],
}
```

Resolution in `resolveWorkflowTaskAgentDefinitionId()`:
1. If `agentSelection` exists, evaluate each rule's condition against workflow state.
2. First matching rule's `agentKey` is resolved to an agent definition ID via `agentIdsByKey`.
3. If no rule matches, use `defaultAgentKey`.
4. If no `agentSelection` block, fall back to the task's static `agentDefinitionId`.

The resolved agent definition ID determines which prompt configuration (`promptId`, `promptTemplate`, `outputSchema`) is used for the LLM call, via `resolveGenerationPromptOverride`.

## 4. Prompt System

### Prompt Override Resolution

`resolveGenerationPromptOverride(workspaceId, agentDefinitionId, fallbackPromptId)`:
1. Load the agent definition's `config` from DB.
2. Extract `promptId` (falls back to `fallbackPromptId` if empty).
3. Extract `promptTemplate` (inline template string with `{{placeholder}}` syntax).
4. Extract `outputSchema` (JSON Schema for structured output).

### Agent Prompt Templates

Each generation agent embeds its prompt template in `config.promptTemplate`. Templates use `{{variable}}` placeholders resolved at call time:

- **List agents** — `{{user_input}}`, `{{folder_name}}`, `{{organization_info}}`, `{{organizations_list}}`, `{{use_case_count}}`
- **Detail agents** — `{{use_case}}`, `{{user_input}}`, `{{organization_info}}`, `{{matrix}}`
- **Matrix agents** — `{{organization_name}}`, `{{organization_info}}`, `{{base_matrix}}`
- **Executive summary** — `{{folder_description}}`, `{{organization_info}}`, `{{top_cas}}`, `{{references_context}}`, `{{use_cases}}`
- **Organization agent** — uses `ORGANIZATION_PROMPTS.organization_info` from `default-chat-system.ts`

### Org-Aware List Prompts

The `buildOrgAwareListPrompt()` factory in `default-org-aware-prompts.ts` generates prompts for org-aware list generation with domain-neutral parameters:

```ts
buildOrgAwareListPrompt({
  listHeadline: "...",      // Domain-specific intro line
  countLabel: "...",         // Label for item count
  researchFocus: "...",      // Web search focus description
  itemLabelSingular: "...", // Singular label (e.g. "cas d'usage", "opportunity")
  itemDescriptionLabel: "...",
})
```

Output schema for org-aware lists (`ORG_AWARE_LIST_OUTPUT_SCHEMA`):
```ts
{ dossier: string, initiatives: [{ titre, description, ref, organizationIds: string[], organizationName: string|null }] }
```

### Structured Output Schemas

Agents declare JSON Schema in `config.outputSchema` for structured LLM responses. Examples:
- **List agents**: `{ dossier: string, initiatives: [{ titre, description, ref }] }`
- **Detail agents**: full initiative payload with `valueScores`, `complexityScores` (Fibonacci ratings: 0,1,3,5,8,13,21,34,55,89,100)
- **Executive summary**: `{ introduction, analyse, recommandation, synthese_executive, references }`

## 5. Tool Dispatch

Tools available in chat sessions are determined by two layers in `chat-service.ts`:

### Context-Type Tools

Selected based on the chat session's context types (`initiative`, `organization`, `folder`, `executive_summary`):

| Context Type | Tools |
|-------------|-------|
| initiative | read_initiative, update_initiative, web_search, web_extract |
| organization | organizations_list, organization_get, organization_update, folders_list, web_search, web_extract |
| folder | folders_list, folder_get, folder_update, matrix_get, matrix_update, initiatives_list, executive_summary_get, executive_summary_update, organization_get, web_search, web_extract |
| executive_summary | executive_summary_get, executive_summary_update, initiatives_list, folder_get, matrix_get, organization_get, web_search, web_extract |

Read-only sessions exclude mutation tools (update_initiative, organization_update, folder_update, etc.).

### Workspace-Type Tools

Additional tools based on workspace type (`api/src/services/chat-service.ts` section 14.2):

| Workspace Type | Additional Tools |
|---------------|-----------------|
| ai-ideas | solutions_list, solution_get, proposals_list, proposal_get, products_list, product_get, gate_review, document_generate, batch_create_organizations |
| opportunity | solutions_list, solution_get, proposals_list, proposal_get, products_list, product_get, gate_review, document_generate, batch_create_organizations |
| neutral | workspace_list, initiative_search, task_dispatch |

### Always-Available Tools

Regardless of context or workspace type:
- `history_analyze` — always added
- `documents` — added when document contexts are present
- `comment_assistant` — added when comment contexts are present
- `plan` — added when TODO tool is requested or enforce mode is active
- `web_search`, `web_extract` — added when explicitly requested via UI toggle

### Tool De-duplication

Tools are collected in a `Map<string, Tool>` (`toolSet`). When the same tool name is added by multiple layers, the last addition wins. This prevents duplicates in the final tool array.

## 6. Chat Tool Integration

### System Prompt Construction

The system prompt is built dynamically based on session context:
1. Web tools system prompt (always included) — instructs batch URL extraction, no pseudo-tool-calls, JSON-only final output.
2. Context-specific instructions based on context type and available tools.
3. VS Code code agent prompt template when `vscodeCodeAgent` payload is present.

### Freeform DOCX Upskill Pattern

The `document_generate` tool supports a two-phase pattern:
1. **Upskill phase** (`action: "upskill"`) — returns DOCX creation skill content for LLM learning. The LLM calls the tool with `action: "upskill"` to receive formatting rules, template structure, and code examples.
2. **Generate phase** (`action: "generate"`) — the LLM provides generated code or template ID, and the system enqueues a DOCX generation job via queue-manager.

This allows the LLM to learn document creation conventions before producing output, improving quality without embedding the full skill in the system prompt.

### Tool Dispatch Flow

When the LLM emits a tool call during chat streaming:
1. Tool name is matched against known handlers in the chat service.
2. Arguments are extracted and validated.
3. The handler executes (DB query, API call, job enqueue, etc.).
4. Result is written as a `tool_call_result` stream event.
5. The stream continues with the LLM processing the tool result.

Key tool handlers:
- `read_initiative` / `update_initiative` — direct DB read/write via tool-service
- `organizations_list` / `organization_get` / `organization_update` — organization CRUD
- `web_search` — Tavily API search
- `web_extract` — URL content extraction (batch-capable)
- `plan` — TODO orchestration (create/list/update tasks)
- `documents` — document content retrieval with section/page selection
- `task_dispatch` — creates TODO item from chat
- `document_generate` — DOCX generation (upskill or generate)
- `comment_assistant` — comment thread resolution proposals
- `history_analyze` — chunked history analysis with merge
