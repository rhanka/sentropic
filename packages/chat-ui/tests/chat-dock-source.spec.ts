/**
 * chat-dock-source.spec.ts — node-env source assertions for ChatDock.svelte.
 *
 * Why a source assertion (not a DOM test): the `.dom.spec.ts` suite is excluded
 * from the CI-run `make test-chat-ui` target (node environment, no Svelte DOM
 * harness). This node-env spec therefore CI-enforces the faithful-dogfooding
 * invariant that effective dock/floating mode resolution lives in ChatDock.
 *
 * Context: when the reusable ChatDock dock-surface was extracted, ownership of
 * `resolveEffectiveChatWidgetMode` moved from the gold ui ChatWidget into
 * ChatDock (the dock chrome legitimately owns docked/floating resolution). The
 * gold ui ChatWidget now binds isDocked/isMobileViewport back from ChatDock
 * instead of recomputing the mode itself. This spec is the moved oracle
 * assertion that previously lived in ui/tests/components/chat/
 * ChatWidget-shell-state.test.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const chatDockSourcePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/components/ChatDock.svelte',
);

describe('ChatDock — effective-mode resolution ownership (source)', () => {
  const source = readFileSync(chatDockSourcePath, 'utf8');

  it('imports the shared resolveEffectiveChatWidgetMode helper', () => {
    expect(source).toContain('resolveEffectiveChatWidgetMode');
    expect(source).toContain("from '../state/chatWidgetShell");
  });

  it('computes effectiveMode by calling resolveEffectiveChatWidgetMode', () => {
    expect(source).toContain('resolveEffectiveChatWidgetMode({');
  });
});
