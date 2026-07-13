import type OpenAI from 'openai';
import { writeStreamEvent } from '../stream-service';
import { toolService } from '../tool-service';
import {
  catalogExecutionSeam,
  executeFoundationSearchCatalog,
  executeFoundationSearchSkills,
  type ResolveFoundationChatToolsInput,
} from './catalog';
import { reconcileTenantId } from '../tenancy/resolve-tenant';

type FoundationToolCall = {
  readonly id: string;
  readonly name: string;
  readonly args: string;
};

type FoundationExecutionOptions = {
  readonly userId: string;
  readonly sessionId: string;
  readonly assistantMessageId: string;
  readonly locale?: string;
};

type FoundationContextType =
  | 'organization'
  | 'folder'
  | 'initiative'
  | 'usecase'
  | 'executive_summary';

type FoundationAllowedByType = {
  readonly organization: ReadonlySet<string>;
  readonly folder: ReadonlySet<string>;
  readonly usecase: ReadonlySet<string>;
  readonly executive_summary: ReadonlySet<string>;
};

export interface ExecuteFoundationSkillToolInput {
  readonly toolCall: FoundationToolCall;
  readonly args: Record<string, unknown>;
  readonly options: FoundationExecutionOptions;
  readonly streamSeq: number;
  readonly sessionWorkspaceId: string;
  readonly workspaceType?: string | null;
  readonly currentUserRole?: string | null;
  readonly readOnly: boolean;
  readonly allowedFolderIds: ReadonlySet<string>;
  readonly allowedByType: FoundationAllowedByType;
  readonly hasContextType: (type: FoundationContextType) => boolean;
  readonly isAllowedOrganizationId: (organizationId: string) => Promise<boolean>;
  readonly tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
}

export interface ExecuteFoundationSkillToolResult {
  readonly handled: boolean;
  readonly result?: unknown;
  readonly streamSeq: number;
}

function activeToolNames(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
): string[] {
  return (tools ?? [])
    .map((tool) =>
      tool.type === 'function' && tool.function?.name ? tool.function.name : '',
    )
    .filter((name): name is string => Boolean(name));
}

async function writeCompletedToolResult(input: {
  readonly assistantMessageId: string;
  readonly toolCallId: string;
  readonly result: unknown;
  readonly streamSeq: number;
}): Promise<number> {
  await writeStreamEvent(
    input.assistantMessageId,
    'tool_call_result',
    { tool_call_id: input.toolCallId, result: input.result },
    input.streamSeq,
    input.assistantMessageId,
  );
  return input.streamSeq + 1;
}

function normalizedCompletedResult(result: unknown): Record<string, unknown> {
  return { status: 'completed', ...(result as Record<string, unknown>) };
}

async function handledCompletedResult(
  input: ExecuteFoundationSkillToolInput,
  result: unknown,
): Promise<ExecuteFoundationSkillToolResult> {
  return {
    handled: true,
    result,
    streamSeq: await writeCompletedToolResult({
      assistantMessageId: input.options.assistantMessageId,
      toolCallId: input.toolCall.id,
      result: normalizedCompletedResult(result),
      streamSeq: input.streamSeq,
    }),
  };
}

async function handledFinalResult(
  input: ExecuteFoundationSkillToolInput,
  result: unknown,
): Promise<ExecuteFoundationSkillToolResult> {
  return {
    handled: true,
    result,
    streamSeq: await writeCompletedToolResult({
      assistantMessageId: input.options.assistantMessageId,
      toolCallId: input.toolCall.id,
      result,
      streamSeq: input.streamSeq,
    }),
  };
}

function optionalSelect(args: Record<string, unknown>): never[] | null {
  return (Array.isArray(args.select) ? args.select : null) as never[] | null;
}

// Forward `updates` raw (array OR object {field:value}) so the executor can
// tolerantly normalize the natural object form some small/nano models emit.
// Do NOT collapse non-array to [] here, or the object form would be lost before
// reaching the executor's normalizer (which then throws "updates is required").
function optionalUpdates(args: Record<string, unknown>): unknown {
  return args.updates;
}

// Forward an optional sibling `patch` object the same way (some models hedge with
// patch{} alongside updates{}). The executor folds it into the canonical updates.
function optionalPatch(args: Record<string, unknown>): unknown {
  return args.patch;
}

function requiredStringArg(
  args: Record<string, unknown>,
  key: string,
  message: string,
): string {
  const value = args[key];
  if (!value || typeof value !== 'string') {
    throw new Error(message);
  }
  return value;
}

async function buildSearchAuthz(
  input: ExecuteFoundationSkillToolInput,
): Promise<ResolveFoundationChatToolsInput> {
  // ARCH-11 G1b (§4.2.2): resolve the tenant upstream and thread it into the sync builder —
  // legacy workspaceId under alias/shadow (zero behavior change), resolved tenant under strict.
  const tenantId = await reconcileTenantId({
    workspaceId: input.sessionWorkspaceId,
    userId: input.options.userId,
    path: 'catalog:search-exec',
  });
  return {
    userId: input.options.userId,
    workspaceId: input.sessionWorkspaceId,
    tenantId,
    workspaceType: input.workspaceType,
    currentUserRole: input.currentUserRole,
    allowedTools: activeToolNames(input.tools),
  };
}

export async function executeFoundationSkillTool(
  input: ExecuteFoundationSkillToolInput,
): Promise<ExecuteFoundationSkillToolResult> {
  const { toolCall, args, options, sessionWorkspaceId } = input;

  if (toolCall.name === 'search_skills') {
    const hits = executeFoundationSearchSkills({
      authz: await buildSearchAuthz(input),
      payload: args as { query: string; limit?: number },
    });
    const result = { status: 'completed', hits };
    return {
      handled: true,
      result,
      streamSeq: await writeCompletedToolResult({
        assistantMessageId: options.assistantMessageId,
        toolCallId: toolCall.id,
        result,
        streamSeq: input.streamSeq,
      }),
    };
  }

  // BR-42b Lot 7: search_catalog — additive cross-kind meta-tool (§3.5).
  // Dispatched immediately after search_skills. Uses compositeCatalogRegistry
  // to search across ALL 5 entry kinds. search_skills is NOT changed.
  if (toolCall.name === 'search_catalog') {
    const result = executeFoundationSearchCatalog(
      args as { query: string; limit?: number; filter?: { kind?: string; category?: string } },
    );
    return {
      handled: true,
      result,
      streamSeq: await writeCompletedToolResult({
        assistantMessageId: options.assistantMessageId,
        toolCallId: toolCall.id,
        result,
        streamSeq: input.streamSeq,
      }),
    };
  }

  if (toolCall.name === 'matrix_get') {
    const folderId = args.folderId;
    if (!folderId || typeof folderId !== 'string') {
      throw new Error('Security: folderId is required');
    }
    if (!input.allowedFolderIds.has(folderId)) {
      throw new Error('Security: folderId does not match allowed contexts');
    }
    const matrix = await toolService.getMatrix(folderId, {
      workspaceId: sessionWorkspaceId,
    });
    const result = { status: 'completed', ...(matrix as Record<string, unknown>) };
    return {
      handled: true,
      result: matrix,
      streamSeq: await writeCompletedToolResult({
        assistantMessageId: options.assistantMessageId,
        toolCallId: toolCall.id,
        result,
        streamSeq: input.streamSeq,
      }),
    };
  }

  if (toolCall.name === 'matrix_update') {
    if (input.readOnly) {
      throw new Error('Read-only workspace: matrix_update is disabled');
    }
    const folderId = args.folderId;
    if (!folderId || typeof folderId !== 'string') {
      throw new Error('Security: folderId is required');
    }
    if (!input.allowedFolderIds.has(folderId)) {
      throw new Error('Security: folderId does not match allowed contexts');
    }
    const update = await toolService.updateMatrix({
      folderId,
      matrixConfig: args.matrixConfig,
      userId: options.userId,
      sessionId: options.sessionId,
      messageId: options.assistantMessageId,
      toolCallId: toolCall.id,
      locale: options.locale,
      workspaceId: sessionWorkspaceId,
    });
    const result = { status: 'completed', ...(update as Record<string, unknown>) };
    return {
      handled: true,
      result: update,
      streamSeq: await writeCompletedToolResult({
        assistantMessageId: options.assistantMessageId,
        toolCallId: toolCall.id,
        result,
        streamSeq: input.streamSeq,
      }),
    };
  }

  if (toolCall.name === 'read_initiative') {
    const initiativeId = args.initiativeId;
    if (
      typeof initiativeId !== 'string' ||
      !input.allowedByType.usecase.has(initiativeId)
    ) {
      throw new Error('Security: initiativeId does not match allowed contexts');
    }
    const readResult = await toolService.readInitiative(initiativeId, {
      workspaceId: sessionWorkspaceId,
      select: optionalSelect(args),
    });
    return handledCompletedResult(input, readResult);
  }

  if (toolCall.name === 'update_initiative') {
    if (input.readOnly) {
      throw new Error('Read-only workspace: initiative update is disabled');
    }
    const initiativeId = args.initiativeId;
    if (
      typeof initiativeId !== 'string' ||
      !input.allowedByType.usecase.has(initiativeId)
    ) {
      throw new Error('Security: initiativeId does not match allowed contexts');
    }
    const updateResult = await toolService.updateInitiativeFields({
      initiativeId,
      updates: optionalUpdates(args),
      patch: optionalPatch(args),
      userId: options.userId,
      sessionId: options.sessionId,
      messageId: options.assistantMessageId,
      toolCallId: toolCall.id,
      locale: options.locale,
      workspaceId: sessionWorkspaceId,
    });
    return handledCompletedResult(input, updateResult);
  }

  if (toolCall.name === 'organizations_list') {
    if (!input.hasContextType('organization')) {
      throw new Error(
        'Security: organizations_list is only available in organization context',
      );
    }
    const listResult = await toolService.listOrganizations({
      workspaceId: sessionWorkspaceId,
      idsOnly: !!args.idsOnly,
      select: optionalSelect(args),
    });
    return handledCompletedResult(input, listResult);
  }

  if (toolCall.name === 'organization_get') {
    const organizationId = requiredStringArg(
      args,
      'organizationId',
      'Security: organizationId is required',
    );
    const allowed = await input.isAllowedOrganizationId(organizationId);
    if (!allowed) {
      throw new Error('Security: organizationId does not match allowed contexts');
    }
    const getResult = await toolService.getOrganization(organizationId, {
      workspaceId: sessionWorkspaceId,
      select: optionalSelect(args),
    });
    return handledCompletedResult(input, getResult);
  }

  if (toolCall.name === 'organization_update') {
    if (input.readOnly) {
      throw new Error('Read-only workspace: organization_update is disabled');
    }
    const organizationId = requiredStringArg(
      args,
      'organizationId',
      'Security: organizationId is required',
    );
    const allowed = await input.isAllowedOrganizationId(organizationId);
    if (!allowed) {
      throw new Error('Security: organizationId does not match allowed contexts');
    }
    const updateResult = await toolService.updateOrganizationFields({
      organizationId,
      updates: optionalUpdates(args),
      patch: optionalPatch(args),
      userId: options.userId,
      sessionId: options.sessionId,
      messageId: options.assistantMessageId,
      toolCallId: toolCall.id,
      locale: options.locale,
      workspaceId: sessionWorkspaceId,
    });
    return handledCompletedResult(input, updateResult);
  }

  if (toolCall.name === 'folders_list') {
    if (!input.hasContextType('organization') && !input.hasContextType('folder')) {
      throw new Error(
        'Security: folders_list is only available in organization/folder context',
      );
    }
    const organizationId =
      typeof args.organizationId === 'string'
        ? args.organizationId
        : (input.allowedByType.organization.values().next().value ?? null);
    const listResult = await toolService.listFolders({
      workspaceId: sessionWorkspaceId,
      organizationId,
      idsOnly: !!args.idsOnly,
      select: optionalSelect(args),
    });
    return handledCompletedResult(input, listResult);
  }

  if (toolCall.name === 'folder_get') {
    const folderId = requiredStringArg(
      args,
      'folderId',
      'Security: folderId is required',
    );
    if (!input.allowedFolderIds.has(folderId)) {
      throw new Error('Security: folderId does not match allowed contexts');
    }
    const getResult = await toolService.getFolder(folderId, {
      workspaceId: sessionWorkspaceId,
      select: optionalSelect(args),
    });
    return handledCompletedResult(input, getResult);
  }

  if (toolCall.name === 'folder_update') {
    if (input.readOnly) {
      throw new Error('Read-only workspace: folder_update is disabled');
    }
    const folderId = requiredStringArg(
      args,
      'folderId',
      'Security: folderId is required',
    );
    if (!input.allowedFolderIds.has(folderId)) {
      throw new Error('Security: folderId does not match allowed contexts');
    }
    const updateResult = await toolService.updateFolderFields({
      folderId,
      updates: optionalUpdates(args),
      patch: optionalPatch(args),
      userId: options.userId,
      sessionId: options.sessionId,
      messageId: options.assistantMessageId,
      toolCallId: toolCall.id,
      locale: options.locale,
      workspaceId: sessionWorkspaceId,
    });
    return handledCompletedResult(input, updateResult);
  }

  if (toolCall.name === 'initiatives_list') {
    const folderId = requiredStringArg(
      args,
      'folderId',
      'Security: folderId is required',
    );
    if (!input.allowedFolderIds.has(folderId)) {
      throw new Error('Security: folderId does not match allowed contexts');
    }
    const listResult = await toolService.listInitiativesForFolder(folderId, {
      workspaceId: sessionWorkspaceId,
      idsOnly: !!args.idsOnly,
      select: optionalSelect(args),
    });
    return handledCompletedResult(input, listResult);
  }

  if (toolCall.name === 'executive_summary_get') {
    const folderId = requiredStringArg(
      args,
      'folderId',
      'Security: folderId is required',
    );
    if (!input.allowedFolderIds.has(folderId)) {
      throw new Error('Security: folderId does not match allowed contexts');
    }
    const getResult = await toolService.getExecutiveSummary(folderId, {
      workspaceId: sessionWorkspaceId,
      select: optionalSelect(args),
    });
    return handledCompletedResult(input, getResult);
  }

  if (toolCall.name === 'executive_summary_update') {
    if (input.readOnly) {
      throw new Error('Read-only workspace: executive_summary_update is disabled');
    }
    const folderId = requiredStringArg(
      args,
      'folderId',
      'Security: folderId is required',
    );
    if (!input.allowedFolderIds.has(folderId)) {
      throw new Error('Security: folderId does not match allowed contexts');
    }
    const updateResult = await toolService.updateExecutiveSummaryFields({
      folderId,
      updates: optionalUpdates(args),
      patch: optionalPatch(args),
      userId: options.userId,
      sessionId: options.sessionId,
      messageId: options.assistantMessageId,
      toolCallId: toolCall.id,
      locale: options.locale,
      workspaceId: sessionWorkspaceId,
    });
    return handledCompletedResult(input, updateResult);
  }

  if (toolCall.name === 'solutions_list') {
    const listResult = await toolService.listSolutions({
      initiativeId: args.initiativeId as string,
      workspaceId: sessionWorkspaceId,
      select: optionalSelect(args),
    });
    return handledFinalResult(input, { status: 'completed', ...listResult });
  }

  if (toolCall.name === 'solution_get') {
    const getResult = await toolService.getSolution(args.solutionId as string, {
      workspaceId: sessionWorkspaceId,
      select: optionalSelect(args),
    });
    return handledFinalResult(input, { status: 'completed', ...getResult });
  }

  if (toolCall.name === 'proposals_list') {
    const listResult = await toolService.listProposals({
      initiativeId: args.initiativeId as string,
      workspaceId: sessionWorkspaceId,
      select: optionalSelect(args),
    });
    return handledFinalResult(input, { status: 'completed', ...listResult });
  }

  if (toolCall.name === 'proposal_get') {
    const getResult = await toolService.getProposal(args.proposalId as string, {
      workspaceId: sessionWorkspaceId,
      select: optionalSelect(args),
    });
    return handledFinalResult(input, { status: 'completed', ...getResult });
  }

  if (toolCall.name === 'products_list') {
    const listResult = await toolService.listProducts({
      workspaceId: sessionWorkspaceId,
      initiativeId:
        typeof args.initiativeId === 'string' ? args.initiativeId : undefined,
      select: optionalSelect(args),
    });
    return handledFinalResult(input, { status: 'completed', ...listResult });
  }

  if (toolCall.name === 'product_get') {
    const getResult = await toolService.getProduct(args.productId as string, {
      workspaceId: sessionWorkspaceId,
      select: optionalSelect(args),
    });
    return handledFinalResult(input, { status: 'completed', ...getResult });
  }

  if (toolCall.name === 'gate_review') {
    const gateResult = await toolService.reviewGate(
      sessionWorkspaceId,
      args.initiativeId as string,
      args.targetStage as string,
    );
    return handledFinalResult(input, { status: 'completed', ...gateResult });
  }

  if (toolCall.name === 'workspace_list') {
    const listResult = await toolService.listWorkspacesForUser(options.userId);
    return handledFinalResult(input, { status: 'completed', ...listResult });
  }

  if (toolCall.name === 'initiative_search') {
    const searchResult = await toolService.searchInitiativesCrossWorkspace(
      options.userId,
      {
        query: typeof args.query === 'string' ? args.query : undefined,
        status: typeof args.status === 'string' ? args.status : undefined,
        maturityStage:
          typeof args.maturityStage === 'string'
            ? args.maturityStage
            : undefined,
      },
    );
    return handledFinalResult(input, { status: 'completed', ...searchResult });
  }

  // -------------------------------------------------------------------------
  // Catalog execution seam (BR-42b Lot 2)
  //
  // All hardcoded foundation tool names have been checked above and did NOT
  // match. Before returning unhandled, consult the catalog execution seam so
  // that standalone `tool`-kind entries (e.g. future MCP tools from Lot 5)
  // can dispatch their handlers.
  //
  // Foundation tools (hardcoded above) ALWAYS dispatch FIRST and never reach
  // this point — the seam is a pure fall-through for non-hardcoded names.
  // -------------------------------------------------------------------------
  const seamResult = await catalogExecutionSeam.execute(toolCall.name, args);
  if (seamResult.handled) {
    return {
      handled: true,
      result: seamResult.result,
      streamSeq: await writeCompletedToolResult({
        assistantMessageId: options.assistantMessageId,
        toolCallId: toolCall.id,
        result: normalizedCompletedResult(seamResult.result),
        streamSeq: input.streamSeq,
      }),
    };
  }

  return { handled: false, streamSeq: input.streamSeq };
}
