import { describe, expect, it } from 'vitest';
import {
  USER_AI_SETTINGS_UPDATED_EVENT,
  emitUserAISettingsUpdated,
} from '../../src/lib/utils/user-ai-settings-events';

describe('user ai settings events', () => {
  it('emits a browser event with updated defaults payload', () => {
    let capturedDetail: unknown = null;
    const handler = (event: Event) => {
      capturedDetail = (event as CustomEvent).detail;
    };

    window.addEventListener(USER_AI_SETTINGS_UPDATED_EVENT, handler);

    emitUserAISettingsUpdated({
      defaultProviderId: 'gemini',
      defaultModel: 'gemini-3.1-pro-preview-customtools',
    });

    window.removeEventListener(USER_AI_SETTINGS_UPDATED_EVENT, handler);

    expect(capturedDetail).toEqual({
      defaultProviderId: 'gemini',
      defaultModel: 'gemini-3.1-pro-preview-customtools',
    });
  });
});
