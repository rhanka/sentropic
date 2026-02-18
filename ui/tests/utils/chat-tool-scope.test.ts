import { describe, expect, it } from 'vitest';
import {
  computeEnabledToolIds,
  computeToolToggleDefaults,
  computeVisibleToolToggleIds,
  isExtensionRestrictedToolsetMode,
  type ChatToolScopeToggle,
} from '../../src/lib/utils/chat-tool-scope';

const TOGGLES: ChatToolScopeToggle[] = [
  { id: 'documents', toolIds: ['documents'] },
  { id: 'web_search', toolIds: ['web_search'] },
  { id: 'web_extract', toolIds: ['web_extract'] },
  { id: 'organization_read', toolIds: ['organizations_list', 'organization_get'] },
];

describe('chat-tool-scope', () => {
  it('keeps restricted mode active after first message when session is flagged as restricted', () => {
    const restricted = isExtensionRestrictedToolsetMode({
      mode: 'ai',
      hasExtensionRuntime: true,
      sessionId: 'session_123',
      extensionRestrictedToolset: true,
    });
    expect(restricted).toBe(true);

    const visibleIds = computeVisibleToolToggleIds({
      toolToggles: TOGGLES,
      restrictedMode: restricted,
    });
    expect(visibleIds).toEqual(['web_search', 'web_extract']);

    const enabledIds = computeEnabledToolIds({
      toolToggles: TOGGLES,
      restrictedMode: restricted,
      toolEnabledById: {
        documents: true,
        web_search: true,
        web_extract: true,
        organization_read: true,
      },
    });
    expect(enabledIds).toEqual(['web_search', 'web_extract']);
  });

  it('uses restricted defaults for extension new sessions', () => {
    const defaults = computeToolToggleDefaults({
      toolToggles: TOGGLES,
      restrictedMode: true,
    });

    expect(defaults.documents).toBe(false);
    expect(defaults.web_search).toBe(true);
    expect(defaults.web_extract).toBe(true);
    expect(defaults.organization_read).toBe(false);
  });

  it('keeps full tool surface outside restricted extension mode', () => {
    const restricted = isExtensionRestrictedToolsetMode({
      mode: 'ai',
      hasExtensionRuntime: true,
      sessionId: 'session_123',
      extensionRestrictedToolset: false,
    });
    expect(restricted).toBe(false);

    const visibleIds = computeVisibleToolToggleIds({
      toolToggles: TOGGLES,
      restrictedMode: restricted,
    });
    expect(visibleIds).toEqual([
      'documents',
      'web_search',
      'web_extract',
      'organization_read',
    ]);
  });
});
