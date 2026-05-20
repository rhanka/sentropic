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
