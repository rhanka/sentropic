<script lang="ts">
  import ChatPanel from '@sentropic/chat-ui/components/ChatPanel.svelte';
  import { createDefaultTransport } from '@sentropic/chat-ui/client/transport';
  import { createStreamHub } from '@sentropic/chat-ui/client/streamHub';
  import { createWebHost } from '@sentropic/chat-ui/hosts/createWebHost';

  // Backend base URL aligned with VITE_API_BASE_URL (.env.example), default {{api_port}}.
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:{{api_port}}';

  // Canonical transport: hits /chat/sessions/:id/{messages,stream,bootstrap}.
  const transport = createDefaultTransport(baseUrl);

  const streamClient = createStreamHub({
    getBaseUrl: () => baseUrl,
    getAuthState: () => true,
  });

  // Web host wiring the chat-ui ChatPanel to the chat-server backend.
  const host = createWebHost({ transport, streamClient });
</script>

<main class="app-shell">
  <header class="app-header">
    <h1>{{name}}</h1>
    <p>Scaffolded with @sentropic/build-cli — chat over @sentropic/chat-server.</p>
  </header>
  <section class="chat-region">
    <ChatPanel {host} />
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, sans-serif;
    background: var(--cds-background, #f4f4f4);
    color: var(--cds-text-primary, #161616);
  }
  .app-shell {
    max-width: 880px;
    margin: 0 auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 100vh;
  }
  .app-header h1 {
    margin: 0;
    font-size: 1.5rem;
  }
  .app-header p {
    margin: 0.25rem 0 0;
    opacity: 0.7;
  }
  .chat-region {
    flex: 1;
    border: 1px solid var(--cds-border-subtle, #e0e0e0);
    border-radius: 8px;
    overflow: hidden;
    background: var(--cds-layer, #fff);
  }
</style>
