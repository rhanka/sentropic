import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/services/stream-service', () => ({ writeStreamEvent: vi.fn() }));
vi.mock('../../../src/services/tool-service', () => ({ toolService: {} }));
import { createCatalogContextResolver } from '../../../src/services/catalog/request-context';
import { standaloneToolSource } from '../../../src/services/catalog/sources/standalone-tool-source';
import { executeFoundationSkillTool } from '../../../src/services/skills/foundation-executor';
import { executeFoundationSearchCatalog, resolveFoundationChatTools } from '../../../src/services/skills/catalog';

afterEach(() => { standaloneToolSource.unregister('artifacts_publish'); });

describe('foundation discovery to execution context', () => {
  it('should select exact names, preserve trusted identity and deny revoked or forged model calls', async () => {
    let revoked = false;
    let effects = 0;
    const handler = vi.fn((_args, context) => { effects++; return { actor: context.subjectId }; });
    standaloneToolSource.register({ tool: { name: 'artifacts_publish', description: 'Private publication',
      inputSchema: {}, sideEffect: true }, handler });
    const resolve = createCatalogContextResolver(async input => {
      if (revoked) throw new Error('revoked');
      return { tenantId: 'tenant-a', membershipRef: 'editor', consentRef: 'turn', policyVersion: 'v1',
        readOnly: false, allowedTools: input.userId === 'alice' ? ['artifacts_publish', 'search_catalog'] : ['search_catalog'] };
    });
    const alice = await resolve({ kind: 'turn', userId: 'alice', sessionId: 'chat-a', workspaceId: 'wa',
      allowedTools: ['artifacts_publish', 'search_catalog'] });
    const bob = await resolve({ kind: 'turn', userId: 'bob', sessionId: 'chat-b', workspaceId: 'wa',
      allowedTools: ['artifacts_publish', 'search_catalog'] });
    const select = (context: typeof alice) => resolveFoundationChatTools({ userId: context.subjectId,
      workspaceId: context.workspaceId, allowedTools: context.allowedTools, context }).map(t => t.function.name);
    expect(select(alice)).toContain('artifacts_publish');
    expect(select(bob)).not.toContain('artifacts_publish');
    expect(executeFoundationSearchCatalog({ payload: { query: 'Private publication' }, context: bob }).hits).toEqual([]);
    const invoke = (context = alice, args = {}) => executeFoundationSkillTool({
      toolCall: { id: 'call', name: 'artifacts_publish', args: JSON.stringify(args) }, args,
      options: { userId: context.subjectId, sessionId: context.sessionId, assistantMessageId: 'message' },
      streamSeq: 0, sessionWorkspaceId: context.workspaceId, readOnly: false, catalogContext: context,
      allowedFolderIds: new Set(), allowedByType: { organization: new Set(), folder: new Set(),
        usecase: new Set(), executive_summary: new Set() }, hasContextType: () => false,
      isAllowedOrganizationId: async () => false, tools: select(context).map(name => ({ type: 'function',
        function: { name, description: name, parameters: {} } })),
    });
    expect(await invoke()).toMatchObject({ handled: true, result: { actor: 'alice' } });
    expect(await invoke(alice, { tenantId: 'forged' })).toMatchObject({ handled: true, result: { error: 'catalog_access_denied' } });
    expect(await invoke(bob)).toMatchObject({ handled: true, result: { error: 'catalog_access_denied' } });
    revoked = true;
    expect(await invoke()).toMatchObject({ handled: true, result: { error: 'catalog_access_denied' } });
    expect(effects).toBe(1);
    expect(handler.mock.calls[0][1]).toMatchObject({ subjectId: 'alice', tenantId: 'tenant-a', workspaceId: 'wa' });
  });
});
