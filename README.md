# Driver Fatigue

Expo Router-based mobile app for monitoring driver fatigue, with a Cloudflare Worker API in [`backend/`](./backend).

## Setup

This repository uses Bun. Install the mobile app dependencies from the repository root:

```bash
bun install
bun run start
```

Routes live in `src/app/`; shared UI and fatigue-detection logic live outside the routes in `src/`.

## Quality checks

```bash
bun run lint
bun run typecheck
bun run test
```

## Backend

```bash
cd backend
bun install
bun run typecheck
```

See [`backend/README.md`](./backend/README.md) for the Worker API, database schema, and deployment setup.
