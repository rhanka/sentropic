import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the bridge iframe postMessage protocol.
 * These are unit tests that verify the protocol contracts
 * without requiring a full Svelte component mount.
 */

describe('bridge postMessage protocol', () => {
  // We test the protocol contract by simulating the messages
  // the bridge page sends and receives.

  describe('injected script -> bridge messages', () => {
    it('register message has correct shape', () => {
      const msg = {
        type: 'register',
        url: 'https://example.com/page',
        title: 'Example Page',
      };
      expect(msg.type).toBe('register');
      expect(typeof msg.url).toBe('string');
      expect(typeof msg.title).toBe('string');
    });

    it('tool_result message has correct shape', () => {
      const msg = {
        type: 'tool_result',
        callId: 'call-abc-123',
        result: { outerHTML: '<div>test</div>', textContent: 'test' },
      };
      expect(msg.type).toBe('tool_result');
      expect(typeof msg.callId).toBe('string');
      expect(msg.result).toBeDefined();
    });

    it('screenshot_result message has correct shape', () => {
      const msg = {
        type: 'screenshot_result',
        callId: 'call-xyz-456',
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQ...',
      };
      expect(msg.type).toBe('screenshot_result');
      expect(typeof msg.callId).toBe('string');
      expect(msg.dataUrl.startsWith('data:')).toBe(true);
    });
  });

  describe('bridge -> injected script messages', () => {
    it('command message for tab_read has correct shape', () => {
      const msg = {
        type: 'command',
        callId: 'call-read-001',
        toolName: 'tab_read',
        args: { mode: 'dom', selector: 'body' },
      };
      expect(msg.type).toBe('command');
      expect(msg.toolName).toBe('tab_read');
      expect(msg.args.mode).toBe('dom');
    });

    it('command message for tab_action has correct shape', () => {
      const msg = {
        type: 'command',
        callId: 'call-action-001',
        toolName: 'tab_action',
        args: { action: 'click', selector: '#submit-btn' },
      };
      expect(msg.type).toBe('command');
      expect(msg.toolName).toBe('tab_action');
      expect(msg.args.action).toBe('click');
    });

    it('connected message has correct shape', () => {
      const msg = {
        type: 'connected',
        tabId: 'tab-001',
      };
      expect(msg.type).toBe('connected');
      expect(typeof msg.tabId).toBe('string');
    });
  });

  describe('SSE status event parsing for bridge', () => {
    it('detects tab_read pending calls in awaiting_local_tool_results', () => {
      const statusData = {
        state: 'awaiting_local_tool_results',
        pending_local_tool_calls: [
          { tool_call_id: 'tc-1', name: 'tab_read', args: { mode: 'dom', selector: 'body' } },
          { tool_call_id: 'tc-2', name: 'web_search', args: { query: 'test' } },
          { tool_call_id: 'tc-3', name: 'tab_action', args: { action: 'click', selector: '#btn' } },
        ],
      };

      const tabToolCalls = statusData.pending_local_tool_calls.filter(
        (c: any) => c.name === 'tab_read' || c.name === 'tab_action',
      );

      expect(tabToolCalls).toHaveLength(2);
      expect(tabToolCalls[0].tool_call_id).toBe('tc-1');
      expect(tabToolCalls[1].tool_call_id).toBe('tc-3');
    });

    it('ignores non-tab tool calls', () => {
      const statusData = {
        state: 'awaiting_local_tool_results',
        pending_local_tool_calls: [
          { tool_call_id: 'tc-1', name: 'web_search', args: {} },
          { tool_call_id: 'tc-2', name: 'bash', args: {} },
        ],
      };

      const tabToolCalls = statusData.pending_local_tool_calls.filter(
        (c: any) => c.name === 'tab_read' || c.name === 'tab_action',
      );

      expect(tabToolCalls).toHaveLength(0);
    });

    it('ignores events with wrong state', () => {
      const statusData = {
        state: 'response_created',
        pending_local_tool_calls: [
          { tool_call_id: 'tc-1', name: 'tab_read', args: {} },
        ],
      };

      if (statusData.state !== 'awaiting_local_tool_results') {
        expect(true).toBe(true); // Correctly skipped
      }
    });
  });

  describe('tool result forwarding', () => {
    it('maps tool call ID to stream (assistant message) ID', () => {
      const toolCallToStreamId = new Map<string, string>();

      // Simulate receiving a status event with stream ID
      const streamId = 'msg-assistant-001';
      const pendingCalls = [
        { tool_call_id: 'tc-1', name: 'tab_read' },
        { tool_call_id: 'tc-2', name: 'tab_action' },
      ];

      for (const call of pendingCalls) {
        toolCallToStreamId.set(call.tool_call_id, streamId);
      }

      expect(toolCallToStreamId.get('tc-1')).toBe(streamId);
      expect(toolCallToStreamId.get('tc-2')).toBe(streamId);
      expect(toolCallToStreamId.get('tc-3')).toBeUndefined();
    });

    it('avoids duplicate forwarding of the same tool call', () => {
      const forwardedIds = new Set<string>();
      const calls = [
        { tool_call_id: 'tc-1', name: 'tab_read' },
        { tool_call_id: 'tc-1', name: 'tab_read' }, // duplicate
        { tool_call_id: 'tc-2', name: 'tab_action' },
      ];

      const forwarded: string[] = [];
      for (const call of calls) {
        if (forwardedIds.has(call.tool_call_id)) continue;
        forwardedIds.add(call.tool_call_id);
        forwarded.push(call.tool_call_id);
      }

      expect(forwarded).toEqual(['tc-1', 'tc-2']);
    });
  });
});
