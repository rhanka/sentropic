import { describe, expect, it, vi } from 'vitest';
import { pauseQueue, reloadQueueSettings, resumeQueue } from '@sentropic/flow';

describe('job queue controls', () => {
  it('pauses the queue through the injected state setter', () => {
    const setPaused = vi.fn();

    pauseQueue({ setPaused });

    expect(setPaused).toHaveBeenCalledWith(true);
  });

  it('resumes the queue and starts processing only when idle', () => {
    const setPaused = vi.fn();
    const startProcessing = vi.fn();

    resumeQueue({
      setPaused,
      isProcessing: () => false,
      startProcessing,
    });

    expect(setPaused).toHaveBeenCalledWith(false);
    expect(startProcessing).toHaveBeenCalledOnce();

    startProcessing.mockClear();
    resumeQueue({
      setPaused,
      isProcessing: () => true,
      startProcessing,
    });

    expect(startProcessing).not.toHaveBeenCalled();
  });

  it('reloads settings through the injected loader', async () => {
    const loadSettings = vi.fn().mockResolvedValue(undefined);

    await reloadQueueSettings({ loadSettings });

    expect(loadSettings).toHaveBeenCalledOnce();
  });
});
