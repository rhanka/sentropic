import { describe, expect, it } from 'vitest';
import {
  getDashboardDocxMenuState,
  reduceDashboardDocxState,
  type DashboardDocxSnapshot,
} from '../../src/lib/utils/dashboard-docx-state';

describe('dashboard docx state utils', () => {
  it('follows idle -> preparing -> ready -> idle transition flow', () => {
    let state: DashboardDocxSnapshot = { state: 'idle', jobId: null };

    state = reduceDashboardDocxState(state, { type: 'prepare_started', jobId: 'job-1' });
    expect(state).toEqual({ state: 'preparing', jobId: 'job-1' });

    state = reduceDashboardDocxState(state, { type: 'prepare_completed', jobId: 'job-1' });
    expect(state).toEqual({ state: 'ready', jobId: 'job-1' });

    state = reduceDashboardDocxState(state, { type: 'downloaded' });
    expect(state).toEqual({ state: 'idle', jobId: null });
  });

  it('resets to idle on content change', () => {
    const state = reduceDashboardDocxState(
      { state: 'ready', jobId: 'job-9' },
      { type: 'content_changed' }
    );
    expect(state).toEqual({ state: 'idle', jobId: null });
  });

  it('derives menu label/disabled from state and folder selection', () => {
    expect(getDashboardDocxMenuState({ state: 'idle', jobId: null }, true)).toEqual({
      labelKey: 'prepare',
      disabled: false,
    });
    expect(getDashboardDocxMenuState({ state: 'preparing', jobId: 'job-1' }, true)).toEqual({
      labelKey: 'preparing',
      disabled: true,
    });
    expect(getDashboardDocxMenuState({ state: 'ready', jobId: 'job-1' }, true)).toEqual({
      labelKey: 'download',
      disabled: false,
    });
    expect(getDashboardDocxMenuState({ state: 'ready', jobId: 'job-1' }, false)).toEqual({
      labelKey: 'download',
      disabled: true,
    });
  });
});
