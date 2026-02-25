export type UserAISettingsUpdatedPayload = {
  defaultProviderId: 'openai' | 'gemini';
  defaultModel: string;
};

export const USER_AI_SETTINGS_UPDATED_EVENT = 'topai:user-ai-settings-updated';

export const emitUserAISettingsUpdated = (
  payload: UserAISettingsUpdatedPayload,
) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<UserAISettingsUpdatedPayload>(
      USER_AI_SETTINGS_UPDATED_EVENT,
      { detail: payload },
    ),
  );
};
