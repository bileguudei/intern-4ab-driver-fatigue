# Driver Fatigue Worker API

Cloudflare Worker backend for the driver-fatigue mobile app. D1 stores structured session, event, sync, and advice data. Camera frames and video are kept in R2; D1 stores only an optional `media_key`.

## API

- `GET|POST /api/drivers`
- `POST /api/sessions`, `GET|PUT /api/sessions/:id`
- `GET /api/sessions/:id/events`
- `POST /api/fatigue-events`
- `POST /api/fatigue-logs` (legacy compatibility)
- `POST /api/sync` with `{ driver_id, operations: [{ operation_id, resource_type, resource_id, payload }] }`
- `GET /api/drivers/:id/history`
- `POST /api/rag/search` with `{ query, limit? }`
- `POST /api/rag/advice` with `{ driver_id, prompt, session_id? }`
- `GET /api/media/:key`

Apply the D1 schema before deploying:

```bash
wrangler d1 execute driver-fatigue-db --remote --file=./schema.sql
```

Create the R2 bucket and Vectorize index named in `wrangler.toml`, then configure the `AI` binding in the Cloudflare dashboard.

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run src/index.ts
```

This project was created using `bun init` in bun v1.4.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
