/** Normalized context view contracts. Context selection/loading lives in chat-runtime. */
export type { ChatContextEntry, ChatContextProvider, ReadableStore } from '@sentropic/chat-core/runtime/state/chat-context';
import type { ChatContextProvider } from '@sentropic/chat-core/runtime/state/chat-context';

/** Empty visual context fallback; it never loads or selects host context. */
export function createNoopChatContextProvider(): ChatContextProvider {
  return {
    context: {
      subscribe(run) {
        run([]);
        return () => undefined;
      },
    },
  };
}
