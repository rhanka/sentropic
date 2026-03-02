import { describe, expect, it } from 'vitest';
import {
  USER_AI_SETTINGS_UPDATED_EVENT,
  emitUserAISettingsUpdated,
} from '../../src/lib/utils/user-ai-settings-events';

describe('user ai settings events', () => {
  it('emits a browser event with updated defaults payload', () => {
    let capturedDetail: unknown = null;
    let capturedType = '';
    let capturedIsCustomEvent = false;
    const handler = (event: Event) => {
      capturedDetail = (event as CustomEvent).detail;
      capturedType = event.type;
      capturedIsCustomEvent = event instanceof CustomEvent;
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
    expect(capturedType).toBe(USER_AI_SETTINGS_UPDATED_EVENT);
    expect(capturedIsCustomEvent).toBe(true);
  });

  it('supports multiple updates in sequence for chat consumers', () => {
    const capturedPayloads: Array<{
      defaultProviderId: 'openai' | 'gemini';
      defaultModel: string;
    }> = [];
    const handler = (event: Event) => {
      capturedPayloads.push((event as CustomEvent).detail);
    };

    window.addEventListener(USER_AI_SETTINGS_UPDATED_EVENT, handler);

    emitUserAISettingsUpdated({
      defaultProviderId: 'openai',
      defaultModel: 'gpt-5.2',
    });
    emitUserAISettingsUpdated({
      defaultProviderId: 'gemini',
      defaultModel: 'gemini-3.1-pro-preview-customtools',
    });

    window.removeEventListener(USER_AI_SETTINGS_UPDATED_EVENT, handler);

    expect(capturedPayloads).toEqual([
      { defaultProviderId: 'openai', defaultModel: 'gpt-5.2' },
      {
        defaultProviderId: 'gemini',
        defaultModel: 'gemini-3.1-pro-preview-customtools',
      },
    ]);
  });
});
