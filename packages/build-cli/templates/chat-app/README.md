# {{name}}

A runnable chat application scaffolded with [`@sentropic/build-cli`](https://www.npmjs.com/package/@sentropic/build-cli)
(`stp app init`). It is a two-tier app:

- **Backend** (`api/`) — a minimal [Hono](https://hono.dev) server that mounts the published
  [`@sentropic/chat-server`](https://www.npmjs.com/package/@sentropic/chat-server) **canonical**
  routes (`POST/GET /chat/sessions/:id/{messages,bootstrap}`, `GET /chat/sessions/:id/stream`)
  over an **in-memory** adapter. No Postgres, no provider key required: it replies with a
  deterministic offline message out of the box.
- **Web UI** (`ui/`) — a [Svelte 5](https://svelte.dev) app embedding
  [`@sentropic/chat-ui`](https://www.npmjs.com/package/@sentropic/chat-ui)'s `ChatPanel`, wired to
  the backend with `createDefaultTransport(VITE_API_BASE_URL)`, styled with the published
  [`@sentropic/design-system-svelte`](https://www.npmjs.com/package/@sentropic/design-system-svelte)
  + themes + tokens.

## Quick start (Docker-first)

```sh
cp .env.example .env   # ports + provider slots (already filled with sane defaults)
make dev               # build + start backend + UI
```

Then open the UI at <http://localhost:{{ui_port}}>. Send a message — it streams an assistant
reply from the backend over `GET /chat/sessions/:id/stream`.

| Service | URL |
|---|---|
| UI      | http://localhost:{{ui_port}} |
| Backend | http://localhost:{{api_port}} |

Stop everything with `make down`.

## Make targets

| Target | What it does |
|---|---|
| `make dev`       | Build + start the backend and UI (Docker Compose). |
| `make down`      | Stop and remove the app's containers. |
| `make typecheck` | Type-check the backend and UI. |
| `make build`     | Build the backend and UI for production. |

## Switching to a real provider

The default `PROVIDER=stub` is a deterministic, offline reply. To use a real model, set
`PROVIDER` in `.env` to one of `openai` / `gemini` / `anthropic` / `mistral` / `cohere` and fill
the matching key slot, then restart `make dev`.

## License

MIT — see [LICENSE](./LICENSE).
