/**
 * @sentropic/flow - small queue control helpers.
 *
 * These functions keep pause/resume/settings-reload behavior in the
 * package while the application owns the actual state flags and
 * processing loop trigger.
 */

export interface PauseQueueDeps {
  setPaused(value: boolean): void;
}

export interface ResumeQueueDeps extends PauseQueueDeps {
  isProcessing(): boolean;
  startProcessing(): void;
}

export interface ReloadQueueSettingsDeps {
  loadSettings(): Promise<void>;
}

export interface QueueSettingsSource {
  concurrency: number;
  publishingConcurrency: number;
  processingInterval: number;
}

export interface QueueRuntimeSettings {
  maxAi: number;
  maxPublishing: number;
  intervalMs: number;
}

export interface LoadQueueSettingsDeps {
  readSettings(): Promise<QueueSettingsSource>;
  applySettings(settings: QueueRuntimeSettings): void;
  logSettings?(settings: QueueRuntimeSettings): void;
  warnLoadFailure?(error: unknown): void;
}

export function pauseQueue(deps: PauseQueueDeps): void {
  deps.setPaused(true);
}

export function resumeQueue(deps: ResumeQueueDeps): void {
  deps.setPaused(false);
  if (!deps.isProcessing()) {
    deps.startProcessing();
  }
}

export async function reloadQueueSettings(
  deps: ReloadQueueSettingsDeps,
): Promise<void> {
  await deps.loadSettings();
}

export async function loadQueueSettings(
  deps: LoadQueueSettingsDeps,
): Promise<void> {
  try {
    const settings = await deps.readSettings();
    const runtimeSettings = {
      maxAi: settings.concurrency,
      maxPublishing: settings.publishingConcurrency,
      intervalMs: settings.processingInterval,
    };
    deps.applySettings(runtimeSettings);
    deps.logSettings?.(runtimeSettings);
  } catch (error) {
    deps.warnLoadFailure?.(error);
  }
}
