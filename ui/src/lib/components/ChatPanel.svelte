<script lang="ts">
  import type { Readable } from 'svelte/store';
  import type { AppContext } from '@sentropic/cowork-bridge/core';
  import type { CommentContextType } from '$lib/utils/comments';
  import PackageChatPanel from '@sentropic/chat-ui/components/ChatPanel.svelte';
  import AppChatPanel from '$lib/components/chat/AppChatPanel.svelte';

  type ChatSession = {
    id: string;
    title?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
    createdAt?: string;
    updatedAt?: string | null;
  };

  export let sessions: ChatSession[] = [];
  export let contextStore: Readable<AppContext>;
  export let sessionId: string | null = null;
  export let draft = '';
  export let loadingSessions = false;
  export let mode: 'ai' | 'comments' = 'ai';
  export let commentContextType: CommentContextType | null = null;
  export let commentContextId: string | null = null;
  export let commentSectionKey: string | null = null;
  export let commentSectionLabel: string | null = null;
  export let commentThreadId: string | null = null;
  export let commentThreads: Array<{
    id: string;
    sectionKey: string | null;
    count: number;
    lastAt: string;
    preview: string;
    authorLabel: string;
    status: 'open' | 'closed';
    assignedTo: string | null;
    rootId: string;
    createdBy: string;
  }> = [];
  export let commentLoading = false;

  let appPanel: any;

  export const focusComposer = async () => appPanel?.focusComposer?.();
  export const selectSession = async (id: string) => appPanel?.selectSession?.(id);
  export const refreshCommentThreads = async () =>
    appPanel?.refreshCommentThreads?.();
  export const newSession = () => appPanel?.newSession?.();
  export const deleteCurrentSession = async () =>
    appPanel?.deleteCurrentSession?.();
</script>

{#snippet renderAppChatPanelShell()}
<AppChatPanel
  bind:this={appPanel}
  bind:sessions
  {contextStore}
  bind:sessionId
  bind:draft
  bind:loadingSessions
  {mode}
  {commentContextType}
  {commentContextId}
  {commentSectionKey}
  {commentSectionLabel}
  bind:commentThreadId
  bind:commentThreads
  bind:commentLoading
/>
{/snippet}

<PackageChatPanel renderShell={renderAppChatPanelShell} />
