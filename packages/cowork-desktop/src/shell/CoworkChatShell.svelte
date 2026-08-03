<script lang="ts">
  import { onDestroy } from 'svelte';
  import ChatConversation from '@sentropic/chat-ui/components/ChatConversation.svelte';
  import SessionList from '@sentropic/chat-ui/components/SessionList.svelte';
  import '@sentropic/chat-ui/theme.css';
  import type { CoworkChatHost, CoworkChatSnapshot } from './cowork-chat-host.js';

  export let chatHost: CoworkChatHost;
  let snapshot: CoworkChatSnapshot = chatHost.getSnapshot();
  const unsubscribe = chatHost.subscribe((next) => { snapshot = next; });
  onDestroy(unsubscribe);

  const selectSession = (sessionId: string): void => { void chatHost.selectSession(sessionId); };
  const createSession = (): void => { void chatHost.createSession(); };
</script>

<main class="cowork-chat-shell" aria-label="Sentropic chat">
  <aside class="cowork-chat-shell-sessions">
    <button type="button" on:click={createSession}>New conversation</button>
    <SessionList
      sessions={snapshot.sessions}
      activeId={snapshot.sessionId ?? undefined}
      labels={chatHost.webHost.labels}
      onSelect={selectSession}
    />
  </aside>
  <section class="cowork-chat-shell-conversation">
    {#if snapshot.error}
      <p role="alert">{snapshot.error}</p>
    {/if}
    {#if snapshot.sessionId}
      {#key snapshot.sessionId}
        <ChatConversation host={chatHost.webHost} sessionId={snapshot.sessionId} layout="docked" />
      {/key}
    {/if}
  </section>
</main>
