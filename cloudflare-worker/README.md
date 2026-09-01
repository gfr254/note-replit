# Cloudflare Worker → Replit article bridge

`worker.js` accepts an article payload and forwards it to the Replit API.

## Production variables and secrets

In Cloudflare, open **Workers & Pages → note-super-shadow-761 → Settings → Variables and Secrets**, select **Production**, and add:

### Variable

- `REPLIT_API_URL` — the public base URL of the Replit API. Do not append `/api/saveArticle`; the Worker adds that path.

### Secrets

- `WORKER_API_KEY` — key required by callers of the Worker.
- `REPLIT_API_KEY` — key the Worker sends to the Replit API.

Set the Replit secret `SAVE_ARTICLE_API_KEY` to the same value as `REPLIT_API_KEY`. Keep `WORKER_API_KEY` separate.

Do not put either key in `worker.js`, `wrangler.toml`, or source control. Add them with the Cloudflare secret UI or:

```bash
wrangler secret put WORKER_API_KEY
wrangler secret put REPLIT_API_KEY
```

The URL in `REPLIT_API_URL` must be publicly reachable over HTTPS. `localhost` and a private preview URL will not work from Cloudflare.

## Request

The Worker accepts `POST /`, `POST /saveArticle`, and `POST /api/saveArticle`.
Callers must send either:

```text
Authorization: Bearer <WORKER_API_KEY>
```

or:

```text
x-api-key: <WORKER_API_KEY>
```

The JSON body is forwarded unchanged:

```json
{
  "date": "2099-12-31",
  "title": "Example article",
  "body": "Markdown body",
  "image": "base64-encoded-png"
}
```

`GET /health` returns `{ "status": "ok" }` after Production configuration and authentication succeed.