export type ChatWidgetTab = 'chat' | 'queue' | 'comments';

export type ChatWidgetDisplayMode = 'floating' | 'docked';

export type ChatWidgetHandoffState = {
  activeTab: ChatWidgetTab;
  chatSessionId: string | null;
  draft: string;
  commentThreadId: string | null;
  commentSectionKey: string | null;
  displayMode: ChatWidgetDisplayMode;
  isOpen: boolean;
  updatedAt: number;
  source: 'content' | 'sidepanel';
};

export const CHATWIDGET_HANDOFF_STORAGE_KEY =
  'topAiIdeas:chatWidgetHandoff:v1';
