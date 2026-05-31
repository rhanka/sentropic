/**
 * BR14a Lot 2 — @sentropic/chat-ui host adapter type tests.
 *
 * Uses vitest `expectTypeOf` for compile-time assertions and runtime
 * checks for the `kind` discriminant narrowing pattern that host code
 * relies on.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AnyHostAdapter,
  ChatAttachmentHostAdapter,
  ChatComposerAttachmentDraft,
  ChromeHostAdapter,
  HostAdapter,
  VsCodeHostAdapter,
  WebHostAdapter,
} from '../src/hosts/types.js';

const describeKind = (adapter: AnyHostAdapter): string => {
  switch (adapter.kind) {
    case 'web':
      return 'web';
    case 'chrome':
      return adapter.injectScript ? 'chrome+inject' : 'chrome';
    case 'vscode':
      return adapter.acquireVsCodeApi ? 'vscode+api' : 'vscode';
  }
};

describe('HostAdapter union', () => {
  it('narrows on the kind discriminant via switch', () => {
    const web: WebHostAdapter = { kind: 'web' };
    const chrome: ChromeHostAdapter = { kind: 'chrome', injectScript: () => undefined };
    const vscode: VsCodeHostAdapter = { kind: 'vscode' };
    expect(describeKind(web)).toBe('web');
    expect(describeKind(chrome)).toBe('chrome+inject');
    expect(describeKind(vscode)).toBe('vscode');
  });

  it('accepts a minimal WebHostAdapter literal', () => {
    const adapter: WebHostAdapter = { kind: 'web' };
    expectTypeOf(adapter).toMatchTypeOf<HostAdapter>();
    expect(adapter.kind).toBe('web');
  });

  it('accepts a ChromeHostAdapter with optional injectScript', () => {
    const adapter: ChromeHostAdapter = {
      kind: 'chrome',
      injectScript: (script) => {
        expect(typeof script).toBe('string');
      },
    };
    expectTypeOf(adapter).toMatchTypeOf<HostAdapter>();
    adapter.injectScript?.('console.log("hello")');
    expect(adapter.kind).toBe('chrome');
  });

  it('accepts a VsCodeHostAdapter with optional acquireVsCodeApi', () => {
    const acquireVsCodeApi = (): unknown => ({ postMessage: () => undefined });
    const adapter: VsCodeHostAdapter = {
      kind: 'vscode',
      acquireVsCodeApi,
    };
    expectTypeOf(adapter).toMatchTypeOf<HostAdapter>();
    expect(adapter.acquireVsCodeApi?.()).toBeDefined();
  });

  it('AnyHostAdapter accepts any of the three concrete shapes', () => {
    const adapters: AnyHostAdapter[] = [
      { kind: 'web' },
      { kind: 'chrome' },
      { kind: 'vscode' },
    ];
    expect(adapters.map((a) => a.kind)).toEqual(['web', 'chrome', 'vscode']);
  });

  it('describes image attachment host callbacks without transport coupling', async () => {
    const attachment: ChatComposerAttachmentDraft = {
      id: 'att_1',
      kind: 'image',
      source: 'paste',
      fileName: 'chart.png',
      mimeType: 'image/png',
      sizeBytes: 1234,
      state: 'pending',
    };
    const adapter: ChatAttachmentHostAdapter = {
      acceptMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      createPreviewUrl: (file) => `blob:${file.name}`,
      uploadAttachment: async (draft) => ({
        ...draft,
        state: 'ready',
        documentId: 'doc_1',
      }),
      removeAttachment: async (draft) => draft.id,
    };

    expectTypeOf(adapter).toMatchTypeOf<ChatAttachmentHostAdapter>();
    await expect(adapter.uploadAttachment(attachment)).resolves.toMatchObject({
      id: 'att_1',
      state: 'ready',
      documentId: 'doc_1',
    });
  });
});
