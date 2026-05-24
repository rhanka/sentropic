import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/stream-service', () => ({
  writeStreamEvent: vi.fn(),
}));

vi.mock('../../src/services/tool-service', () => ({
  toolService: {
    getFolder: vi.fn(),
    updateFolderFields: vi.fn(),
  },
}));

import { writeStreamEvent } from '../../src/services/stream-service';
import { toolService } from '../../src/services/tool-service';
import {
  executeFoundationSkillTool,
  type ExecuteFoundationSkillToolInput,
} from '../../src/services/skills/foundation-executor';

function baseInput(
  overrides: Partial<ExecuteFoundationSkillToolInput> = {},
): ExecuteFoundationSkillToolInput {
  return {
    toolCall: { id: 'call_1', name: 'folder_get', args: '{}' },
    args: {},
    options: {
      userId: 'user_1',
      sessionId: 'session_1',
      assistantMessageId: 'assistant_1',
      locale: 'en',
    },
    streamSeq: 7,
    sessionWorkspaceId: 'workspace_1',
    workspaceType: 'neutral',
    currentUserRole: 'editor',
    readOnly: false,
    allowedFolderIds: new Set(['folder_1']),
    allowedByType: {
      organization: new Set(['org_1']),
      folder: new Set(['folder_1']),
      usecase: new Set(),
      executive_summary: new Set(),
    },
    hasContextType: (type) => type === 'folder' || type === 'organization',
    isAllowedOrganizationId: async (organizationId) => organizationId === 'org_1',
    tools: undefined,
    ...overrides,
  };
}

describe('executeFoundationSkillTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeStreamEvent).mockResolvedValue(undefined);
  });

  it('executes folder_get inside the foundation executor', async () => {
    vi.mocked(toolService.getFolder).mockResolvedValue({
      id: 'folder_1',
      name: 'Folder 1',
    } as Awaited<ReturnType<typeof toolService.getFolder>>);

    const result = await executeFoundationSkillTool(
      baseInput({
        args: { folderId: 'folder_1', select: ['name'] },
      }),
    );

    expect(result.handled).toBe(true);
    expect(result.result).toEqual({ id: 'folder_1', name: 'Folder 1' });
    expect(result.streamSeq).toBe(8);
    expect(toolService.getFolder).toHaveBeenCalledWith('folder_1', {
      workspaceId: 'workspace_1',
      select: ['name'],
    });
    expect(writeStreamEvent).toHaveBeenCalledWith(
      'assistant_1',
      'tool_call_result',
      {
        tool_call_id: 'call_1',
        result: { status: 'completed', id: 'folder_1', name: 'Folder 1' },
      },
      7,
      'assistant_1',
    );
  });

  it('rejects folder_update in read-only mode before calling the tool service', async () => {
    await expect(
      executeFoundationSkillTool(
        baseInput({
          toolCall: { id: 'call_2', name: 'folder_update', args: '{}' },
          args: { folderId: 'folder_1', updates: [] },
          readOnly: true,
        }),
      ),
    ).rejects.toThrow('Read-only workspace: folder_update is disabled');

    expect(toolService.updateFolderFields).not.toHaveBeenCalled();
    expect(writeStreamEvent).not.toHaveBeenCalled();
  });
});
