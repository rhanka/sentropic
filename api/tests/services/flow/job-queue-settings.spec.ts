import { describe, expect, it, vi } from 'vitest';
import { loadQueueSettings } from '@sentropic/flow';

describe('job queue settings', () => {
  it('loads and applies processing loop settings through injected hooks', async () => {
    const applySettings = vi.fn();
    const logSettings = vi.fn();

    await loadQueueSettings({
      readSettings: async () => ({
        concurrency: 7,
        publishingConcurrency: 3,
        processingInterval: 250,
      }),
      applySettings,
      logSettings,
    });

    expect(applySettings).toHaveBeenCalledWith({
      maxAi: 7,
      maxPublishing: 3,
      intervalMs: 250,
    });
    expect(logSettings).toHaveBeenCalledWith({
      maxAi: 7,
      maxPublishing: 3,
      intervalMs: 250,
    });
  });

  it('keeps current settings when the injected reader fails', async () => {
    const error = new Error('settings unavailable');
    const applySettings = vi.fn();
    const warnLoadFailure = vi.fn();

    await loadQueueSettings({
      readSettings: async () => {
        throw error;
      },
      applySettings,
      warnLoadFailure,
    });

    expect(applySettings).not.toHaveBeenCalled();
    expect(warnLoadFailure).toHaveBeenCalledWith(error);
  });
});
