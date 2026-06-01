/**
 * {{name}} backend.
 *
 * Mounts the published @sentropic/chat-server CANONICAL routes
 * (POST/GET /chat/sessions/:id/{messages,bootstrap}, GET /chat/sessions/:id/stream)
 * over its OFFLINE in-memory adapter. No Postgres, no provider key required: the
 * in-memory deps reply with a deterministic message so a chat round-trip works out of
 * the box. Switch to a real provider by extending these deps (see README).
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createChatServer, createInMemoryChatServerDeps } from '@sentropic/chat-server';

const PORT = Number(process.env.PORT ?? {{api_port}});
const ASSISTANT_REPLY = '{{assistant_reply}}';

// The chat wire server: canonical routes consumed by @sentropic/chat-ui's
// createDefaultTransport(baseUrl). Offline in-memory adapter = deterministic reply.
const chat = createChatServer(
  createInMemoryChatServerDeps({ assistantReply: ASSISTANT_REPLY }),
  { routes: 'canonical' },
);

const app = new Hono();

// Allow the UI (served on a different port) to call the chat routes + read SSE.
app.use('*', async (c, next) => {
  c.header('access-control-allow-origin', '*');
  c.header('access-control-allow-headers', 'content-type, x-app-locale');
  c.header('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

app.get('/health', (c) => c.json({ status: 'ok' }));

// Mount the chat-server routes at the root: the transport hits /chat/sessions/:id/*.
app.route('/', chat);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`{{name}} backend listening on http://localhost:${info.port}`);
});
