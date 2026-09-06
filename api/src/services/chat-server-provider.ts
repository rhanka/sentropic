import type { ChatServerDeps } from '../../../packages/chat-server/src/index';

import type { ChatContextType } from './chat-service';
import { chatService } from './chat-service';
import { chatControls } from './chat-controls';
import { chatExtensionPermissionService } from './chat-extension-permissions';
import type { ProviderId } from './provider-runtime';
import { queueManager, type ChatMessageJobData } from './queue-manager';

const providerId = (value: string | null | undefined): ProviderId | undefined =>
  value ? value as ProviderId : undefined;
const providerIdOrNull = (value: string | null | undefined): ProviderId | null =>
  value ? value as ProviderId : null;
const contexts = (
  value: Array<{ contextType: string; contextId: string }> | undefined,
): Array<{ contextType: ChatContextType; contextId: string }> | undefined =>
  value?.map((context) => ({
    contextType: context.contextType as ChatContextType,
    contextId: context.contextId,
  }));

export const createProductChatServerDeps = (): ChatServerDeps => ({
  getUser: (context) => context.get('user'),
  sessions: {
    listSessions: (input) => chatService.listSessions(
      input.userId,
      input.workspaceId,
      input.limit,
    ),
    createSession: (input) => chatService.createSession({
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      primaryContextType: input.primaryContextType as ChatContextType | null | undefined,
      primaryContextId: input.primaryContextId ?? null,
      title: input.title ?? null,
    }),
    getSessionHistory: (input) => chatService.getSessionHistory(input),
    deleteSession: (input) => chatService.deleteSession(input.sessionId, input.userId),
  },
  messages: {
    createUserMessageWithAssistantPlaceholder: (input) =>
      chatService.createUserMessageWithAssistantPlaceholder({
        ...input,
        providerId: providerIdOrNull(input.providerId),
        providerApiKey: input.providerApiKey ?? null,
        workspaceId: input.workspaceId ?? null,
        primaryContextType: input.primaryContextType as ChatContextType | null | undefined,
        primaryContextId: input.primaryContextId ?? null,
        contexts: contexts(input.contexts),
        attachments: input.attachments ?? null,
        sessionTitle: input.sessionTitle ?? null,
      }),
    listMessages: (input) => chatService.listMessages(input.sessionId, input.userId),
    getSessionBootstrap: (input) => chatService.getSessionBootstrap(input),
    getMessageRuntimeDetails: (input) => chatService.getMessageRuntimeDetails(input),
    updateUserMessageContent: (input) => chatService.updateUserMessageContent(input),
    getMessageForUser: (input) => chatService.getMessageForUser(input.messageId, input.userId),
    stopAssistantMessage: (input) => chatControls.stop(input),
    steerAssistantMessage: (input) => chatControls.steer(input),
    setMessageFeedback: async (input) => {
      const result = await chatService.setMessageFeedback(input);
      return { messageId: input.messageId, vote: result.vote };
    },
    retryUserMessage: (input) => chatService.retryUserMessage({
      ...input,
      providerId: providerIdOrNull(input.providerId),
      model: input.model ?? null,
    }),
    acceptLocalToolResult: (input) => chatService.acceptLocalToolResult(input),
    createCheckpoint: (input) => chatService.createCheckpoint({
      ...input,
      title: input.title ?? null,
      anchorMessageId: input.anchorMessageId ?? null,
    }),
    listCheckpoints: (input) => chatService.listCheckpoints(input),
    restoreCheckpoint: (input) => chatService.restoreCheckpoint(input),
  },
  extensions: {
    listToolPermissions: (input) => chatExtensionPermissionService.list(input),
    upsertToolPermission: (input) => chatExtensionPermissionService.upsert(input),
    deleteToolPermission: (input) => chatExtensionPermissionService.delete(input),
  },
  queue: {
    enqueueChatMessage: (input, options) => queueManager.addJob(
      'chat_message',
      {
        ...input,
        providerId: providerId(input.providerId),
        model: input.model ?? undefined,
        contexts: contexts(input.contexts),
        localToolDefinitions:
          input.localToolDefinitions as ChatMessageJobData['localToolDefinitions'],
        vscodeCodeAgent: input.vscodeCodeAgent as ChatMessageJobData['vscodeCodeAgent'],
        resumeFrom: input.resumeFrom as ChatMessageJobData['resumeFrom'],
      },
      { workspaceId: options?.workspaceId ?? undefined },
    ),
  },
  stream: {
    readSessionEvents: async () => [],
  },
});
