export type DashboardDocxState = 'idle' | 'preparing' | 'ready';

export type DashboardDocxSnapshot = {
  state: DashboardDocxState;
  jobId: string | null;
};

export type DashboardDocxEvent =
  | { type: 'prepare_started'; jobId: string }
  | { type: 'prepare_completed'; jobId: string }
  | { type: 'prepare_failed' }
  | { type: 'downloaded' }
  | { type: 'content_changed' }
  | { type: 'cleared' };

export type DashboardDocxMenuState = {
  labelKey: 'prepare' | 'preparing' | 'download';
  disabled: boolean;
};

export function reduceDashboardDocxState(
  current: DashboardDocxSnapshot,
  event: DashboardDocxEvent
): DashboardDocxSnapshot {
  switch (event.type) {
    case 'prepare_started':
      return { state: 'preparing', jobId: event.jobId };
    case 'prepare_completed':
      return { state: 'ready', jobId: event.jobId };
    case 'prepare_failed':
    case 'downloaded':
    case 'content_changed':
    case 'cleared':
      return { state: 'idle', jobId: null };
    default:
      return current;
  }
}

export function getDashboardDocxMenuState(
  snapshot: DashboardDocxSnapshot,
  hasSelectedFolder: boolean
): DashboardDocxMenuState {
  const labelKey =
    snapshot.state === 'preparing'
      ? 'preparing'
      : snapshot.state === 'ready'
        ? 'download'
        : 'prepare';

  return {
    labelKey,
    disabled: !hasSelectedFolder || snapshot.state === 'preparing',
  };
}
