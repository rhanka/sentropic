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
  { id: 'tab_read', toolIds: ['tab_read'] },
  { id: 'tab_action', toolIds: ['tab_action'] },
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
    expect(visibleIds).toEqual([
      'web_search',
      'web_extract',
      'tab_read',
      'tab_action',
    ]);

    const enabledIds = computeEnabledToolIds({
      toolToggles: TOGGLES,
      restrictedMode: restricted,
      toolEnabledById: {
        documents: true,
        web_search: true,
        web_extract: true,
        tab_read: true,
        tab_action: true,
        organization_read: true,
      },
    });
    expect(enabledIds).toEqual([
      'web_search',
      'web_extract',
      'tab_read',
      'tab_action',
    ]);
  });

  it('uses restricted defaults for extension new sessions', () => {
    const defaults = computeToolToggleDefaults({
      toolToggles: TOGGLES,
      restrictedMode: true,
    });

    expect(defaults.documents).toBe(false);
    expect(defaults.web_search).toBe(true);
    expect(defaults.web_extract).toBe(true);
    expect(defaults.tab_read).toBe(true);
    expect(defaults.tab_action).toBe(true);
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
      'tab_read',
      'tab_action',
      'organization_read',
    ]);
  });

  it('filters out local tools when explicitly disabled in restricted mode', () => {
    const enabledIds = computeEnabledToolIds({
      toolToggles: TOGGLES,
      restrictedMode: true,
      toolEnabledById: {
        documents: false,
        web_search: true,
        web_extract: true,
        tab_read: false,
        tab_action: true,
        organization_read: false,
      },
    });

    expect(enabledIds).toEqual(['web_search', 'web_extract', 'tab_action']);
    expect(enabledIds).not.toContain('documents');
    expect(enabledIds).not.toContain('organizations_list');
  });
});
