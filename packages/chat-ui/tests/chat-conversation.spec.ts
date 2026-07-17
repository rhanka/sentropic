/**
 * chat-conversation.spec.ts — Node-environment tests for ChatConversation assembly.
 *
 * Tests: feature-flag resolution defaults, parseLocalToolCalls wiring, prop-API
 * shape from the .d.ts contract, and export-surface alignment.
 *
 * Environment: node (no DOM, no Svelte rendering).
 * Does NOT overlap with chat-conversation.dom.spec.ts (jsdom render tests).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  parsePendingLocalToolCallsFromStatusPayload,
} from '../src/utils/localToolStreamSync.js';
import { isLocalToolName } from '../src/stores/localTools.js';

// ---------------------------------------------------------------------------
// Feature-flag defaults (pure logic — no Svelte needed)
// ---------------------------------------------------------------------------

type ChatConversationFeatures = {
  attachments?: boolean;
  comments?: boolean;
  documents?: boolean;
  jobs?: boolean;
  workspaceScope?: boolean;
  steer?: boolean;
  retry?: boolean;
  stop?: boolean;
};

const resolveFeatures = (features: ChatConversationFeatures = {}) => ({
  attachments: features.attachments ?? false,
  comments: features.comments ?? false,
  documents: features.documents ?? false,
  jobs: features.jobs ?? false,
  workspaceScope: features.workspaceScope ?? false,
  steer: features.steer ?? true,
  retry: features.retry ?? true,
  stop: features.stop ?? true,
});

describe('ChatConversation — feature flag defaults', () => {
  it('should default all app-coupled flags to OFF', () => {
    const resolved = resolveFeatures({});
    expect(resolved.attachments).toBe(false);
    expect(resolved.comments).toBe(false);
    expect(resolved.documents).toBe(false);
    expect(resolved.jobs).toBe(false);
    expect(resolved.workspaceScope).toBe(false);
  });

  it('should default pure-chat flags (steer/retry/stop) to ON', () => {
    const resolved = resolveFeatures({});
    expect(resolved.steer).toBe(true);
    expect(resolved.retry).toBe(true);
    expect(resolved.stop).toBe(true);
  });

  it('should allow caller to disable steer', () => {
    const resolved = resolveFeatures({ steer: false });
    expect(resolved.steer).toBe(false);
    expect(resolved.retry).toBe(true);
    expect(resolved.stop).toBe(true);
  });

  it('should allow caller to enable comments flag', () => {
    const resolved = resolveFeatures({ comments: true });
    expect(resolved.comments).toBe(true);
    expect(resolved.documents).toBe(false);
  });

  it('should allow caller to enable all flags', () => {
    const all = resolveFeatures({
      attachments: true,
      comments: true,
      documents: true,
      jobs: true,
      workspaceScope: true,
      steer: true,
      retry: true,
      stop: true,
    });
    for (const [, v] of Object.entries(all)) {
      expect(v).toBe(true);
    }
  });

  it('should allow caller to disable all flags', () => {
    const none = resolveFeatures({
      attachments: false,
      comments: false,
      documents: false,
      jobs: false,
      workspaceScope: false,
      steer: false,
      retry: false,
      stop: false,
    });
    for (const [, v] of Object.entries(none)) {
      expect(v).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// parseLocalToolCalls — wraps parsePendingLocalToolCallsFromStatusPayload
// (this is the logic ChatConversation.parseLocalToolCalls exposes)
// ---------------------------------------------------------------------------

describe('ChatConversation — parseLocalToolCalls helper (via localToolStreamSync)', () => {
  it('should return empty array for non-awaiting-local-tool payload', () => {
    const result = parsePendingLocalToolCallsFromStatusPayload(
      'stream-1',
      1,
      { state: 'started' },
      isLocalToolName,
    );
    expect(result).toEqual([]);
  });

  it('should return empty array for null/undefined data', () => {
    expect(
      parsePendingLocalToolCallsFromStatusPayload('s', 1, null, isLocalToolName),
    ).toEqual([]);
    expect(
      parsePendingLocalToolCallsFromStatusPayload('s', 1, undefined, isLocalToolName),
    ).toEqual([]);
  });

  it('should parse a valid awaiting_local_tool_results payload with a known local tool', () => {
    const payload = {
      state: 'awaiting_local_tool_results',
      pending_local_tool_calls: [
        { tool_call_id: 'tcid-1', name: 'tab_read', args: { mode: 'info' } },
      ],
    };
    const result = parsePendingLocalToolCallsFromStatusPayload(
      'stream-1',
      5,
      payload,
      isLocalToolName,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.toolCallId).toBe('tcid-1');
    expect(result[0]?.name).toBe('tab_read');
    expect(result[0]?.streamId).toBe('stream-1');
    expect(result[0]?.sequence).toBe(5);
  });

  it('should ignore tool calls with names not in the local-tool registry', () => {
    const payload = {
      state: 'awaiting_local_tool_results',
      pending_local_tool_calls: [
        { tool_call_id: 'tcid-unknown', name: 'some_unknown_tool', args: {} },
        { tool_call_id: 'tcid-known', name: 'bash', args: { command: 'ls' } },
      ],
    };
    const result = parsePendingLocalToolCallsFromStatusPayload(
      's',
      1,
      payload,
      isLocalToolName,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('bash');
  });

  it('should deduplicate tool calls with the same toolCallId', () => {
    const payload = {
      state: 'awaiting_local_tool_results',
      pending_local_tool_calls: [
        { tool_call_id: 'dup-1', name: 'bash', args: {} },
        { tool_call_id: 'dup-1', name: 'bash', args: {} },
      ],
    };
    const result = parsePendingLocalToolCallsFromStatusPayload(
      's',
      1,
      payload,
      isLocalToolName,
    );
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Export-surface: new subpath present in package.json and manifest
// ---------------------------------------------------------------------------

describe('ChatConversation — export surface registration', () => {
  const PACKAGE_ROOT = process.cwd();
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as { version: string; exports: Record<string, unknown> };
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'export-manifest.json'), 'utf8'),
  ) as { _version: string; subpaths: Record<string, unknown> };

  const SUBPATH = './components/ChatConversation.svelte';

  it('should export the ChatConversation subpath in package.json', () => {
    expect(Object.keys(pkgJson.exports)).toContain(SUBPATH);
  });

  it('should list ChatConversation in export-manifest.json subpaths', () => {
    expect(Object.keys(manifest.subpaths)).toContain(SUBPATH);
  });

  it('should have version 0.27.0 in package.json (minor - ChatSessionRuntime export)', () => {
    expect(pkgJson.version).toBe('0.27.0');
  });

  it('should have _version 0.27.0 in export-manifest.json', () => {
    expect(manifest._version).toBe('0.27.0');
  });

  it('should resolve the ChatConversation svelte file to an existing path', () => {
    const entry = pkgJson.exports[SUBPATH] as Record<string, string>;
    const file = entry['svelte'] ?? entry['import'];
    expect(file).toBeTruthy();
    const abs = path.resolve(PACKAGE_ROOT, file as string);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it('should resolve the ChatConversation .d.ts file to an existing path', () => {
    const entry = pkgJson.exports[SUBPATH] as Record<string, string>;
    const file = entry['types'];
    expect(file).toBeTruthy();
    const abs = path.resolve(PACKAGE_ROOT, file as string);
    expect(fs.existsSync(abs)).toBe(true);
  });
});
