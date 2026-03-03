import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteLocalToolPermissionPolicy,
  listLocalToolPermissionPolicies,
  upsertLocalToolPermissionPolicy,
} from '../../src/lib/stores/localTools';

describe('vscode extension tool permissions bridge', () => {
  beforeEach(() => {
    delete (globalThis as any).chrome;
  });

  it('lists, upserts and deletes permission policies with optional path scope', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        items: [
          {
            toolName: 'ls',
            origin: 'vscode://workspace',
            policy: 'allow',
            pathPattern: 'src/*',
            updatedAt: '2026-03-03T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        item: {
          toolName: 'file_edit',
          origin: 'vscode://workspace',
          policy: 'deny',
          pathPattern: 'secrets/*',
          updatedAt: '2026-03-03T00:00:01.000Z',
        },
      })
      .mockResolvedValueOnce({ ok: true });

    (globalThis as any).chrome = {
      runtime: {
        id: 'topai.vscode.runtime',
        sendMessage,
      },
    };

    const listed = await listLocalToolPermissionPolicies();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      toolName: 'ls',
      pathPattern: 'src/*',
    });

    const updated = await upsertLocalToolPermissionPolicy({
      toolName: 'file_edit',
      origin: 'vscode://workspace',
      policy: 'deny',
      pathPattern: 'secrets/*',
    });
    expect(updated).toMatchObject({
      toolName: 'file_edit',
      pathPattern: 'secrets/*',
    });

    await deleteLocalToolPermissionPolicy({
      toolName: 'file_edit',
      origin: 'vscode://workspace',
      pathPattern: 'secrets/*',
    });

    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'extension_tool_permissions_upsert',
      payload: {
        toolName: 'file_edit',
        origin: 'vscode://workspace',
        policy: 'deny',
        pathPattern: 'secrets/*',
      },
    });

    expect(sendMessage).toHaveBeenNthCalledWith(3, {
      type: 'extension_tool_permissions_delete',
      payload: {
        toolName: 'file_edit',
        origin: 'vscode://workspace',
        pathPattern: 'secrets/*',
      },
    });
  });
});
