import { describe, expect, it, vi } from 'vitest';

import { createChromeLocalToolsAdapter } from '../../src/lib/upstream/chrome-host-adapter';

describe('createChromeLocalToolsAdapter', () => {
  it('forwards the raw envelope returned by runtime.sendMessage', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { value: 42 } });
    const adapter = createChromeLocalToolsAdapter({
      runtime: { id: 'topai.chrome.runtime', sendMessage },
    });

    const response = await adapter.sendMessage?.({ type: 'tool_execute' });

    expect(adapter.id).toBe('topai.chrome.runtime');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'tool_execute' });
    expect(response).toEqual({ ok: true, result: { value: 42 } });
  });

  it('returns an error envelope when runtime is unavailable', async () => {
    const adapter = createChromeLocalToolsAdapter({ runtime: null });

    const response = await adapter.sendMessage?.({ type: 'tool_execute' });

    expect(response).toMatchObject({
      ok: false,
      error: 'Chrome runtime sendMessage is unavailable.',
    });
  });

  it('catches sendMessage rejections and surfaces them as ok=false', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('extension offline'));
    const adapter = createChromeLocalToolsAdapter({
      runtime: { id: 'topai.chrome.runtime', sendMessage },
    });

    const response = await adapter.sendMessage?.({ type: 'tool_execute' });

    expect(response).toEqual({ ok: false, error: 'extension offline' });
  });

  it('falls back to a stable id when chrome.runtime omits one', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const adapter = createChromeLocalToolsAdapter({
      runtime: { sendMessage },
    });

    expect(adapter.id).toBe('topai.chrome.runtime');
  });
});
