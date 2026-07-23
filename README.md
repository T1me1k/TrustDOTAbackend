# TRUST Dota 2 Backend

First-stage backend for TRUST Dota 2: Fastify REST API, Socket.IO, PostgreSQL/Drizzle schema, runtime configuration, mock matchmaking utilities, bootstrap admin API, and Railway-ready deployment. Steam OpenID, Dota API, payments, tournaments, anticheat, ML matchmaking, email, frontend, and admin UI are intentionally left for later stages.

## Architecture

- `src/index.ts` starts one Node.js 20 process for API, Socket.IO, and the matchmaking worker lifecycle.
- `src/app.ts` builds the Fastify app with Helmet, strict CORS, rate limits, signed cookies, unified errors, auth, queue, match, config, and admin routes.
- `src/db/schema.ts` defines Drizzle tables for players, roles, queue entries, matches, audit logs, runtime config, feature flags, patches, sanctions, and immutable rating/trust events.
- `src/worker/matcher.ts` contains worker lifecycle primitives and pure matchmaking utilities for rating expansion and role-balanced teams.

## Local development

```bash
npm install
docker compose up -d
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Use local secrets at least 32 characters long. Do not commit `.env`.

## Scripts

- `npm run dev` - TS development server.
- `npm run build` - compile to `dist`.
- `npm start` - run production build from `dist`.
- `npm run lint`, `npm run typecheck`, `npm run test` - checks.
- `npm run db:generate`, `npm run db:migrate`, `npm run db:seed` - Drizzle workflows.

## API endpoints

Public/system:
- `GET /health`
- `GET /ready`
- `GET /v1/config/public`

Auth:
- `POST /v1/auth/dev` (unsafe temporary mode, requires `ALLOW_DEV_AUTH=true`)
- `POST /v1/auth/logout`
- `GET /v1/me`

Queue:
- `POST /v1/queue/join`
- `POST /v1/queue/cancel`
- `GET /v1/queue/status`

Matches:
- `GET /v1/matches/:id`
- `POST /v1/matches/:id/accept`
- `POST /v1/matches/:id/decline`

Admin (`Authorization: Bearer <ADMIN_API_KEY>`):
- `GET /v1/admin/dashboard`
- `GET /v1/admin/config`
- `PATCH /v1/admin/config/:key`
- `GET /v1/admin/feature-flags`
- `PATCH /v1/admin/feature-flags/:key`
- `GET /v1/admin/queues`
- `GET /v1/admin/matches`
- `POST /v1/admin/matches/:id/cancel`
- `GET /v1/admin/audit`

Socket.IO server events: `queue:updated`, `match:found`, `match:acceptance_updated`, `match:ready`, `match:cancelled`, `config:updated`, `maintenance:updated`. Rooms are `player:<playerId>`, `match:<matchId>`, and `public-config`.

## Curl examples

```bash
curl http://localhost:4000/health
curl -i -c cookies.txt -H 'Content-Type: application/json' -d '{"displayName":"VoidLegacy"}' http://localhost:4000/v1/auth/dev
curl -b cookies.txt http://localhost:4000/v1/me
curl -b cookies.txt -H 'Content-Type: application/json' -d '{"region":"EU West","primaryRole":"Mid","secondaryRole":"Soft Support"}' http://localhost:4000/v1/queue/join
curl -b cookies.txt http://localhost:4000/v1/queue/status
curl -b cookies.txt -X POST http://localhost:4000/v1/queue/cancel
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:4000/v1/admin/config
curl -b cookies.txt -X POST http://localhost:4000/v1/matches/<match-id>/accept
```

## Environment variables

See `.env.example` for the full list. Required secrets:
- `DATABASE_URL` - Railway PostgreSQL URL.
- `SESSION_SECRET` - at least 32 chars; generate with `openssl rand -base64 48`.
- `ADMIN_API_KEY` - at least 32 chars; rotate by changing the Railway variable and redeploying.

Production safety:
- `ALLOW_DEV_AUTH=false`
- `MATCHMAKING_BOT_FILL=false`
- `CORS_ORIGINS` must contain only trusted Vercel/Railway frontend origins.

## Railway deployment

1. Create a Railway project and add a PostgreSQL service.
2. Link the backend service to the PostgreSQL service and set `DATABASE_URL` from Railway's provided connection string.
3. Add `NODE_ENV=production`, `PORT`, `FRONTEND_URL`, `CORS_ORIGINS`, `SESSION_SECRET`, `ADMIN_API_KEY`, `ALLOW_DEV_AUTH=false`, `MATCHMAKING_ENABLED=true`, `MATCHMAKING_BOT_FILL=false`, timing variables, and `LOG_LEVEL=info`.
4. Build command: Dockerfile build (or `npm ci && npm run build`).
5. Start command: `npm start`.
6. Healthcheck path: `/health`.
7. Generate a public Railway domain from the service Settings / Networking page.
8. Add the Vercel URL to `FRONTEND_URL` and `CORS_ORIGINS`.
9. Connect GitHub and deploy through PR/main updates; never push secrets.
10. View logs in Railway Deployments or `railway logs`.
11. Run migrations with `npm run db:migrate` as a one-off Railway command before/with deployment.
12. Disable mock bots with `MATCHMAKING_BOT_FILL=false` and `runtime_config.bot_fill_enabled=false`.
13. Rotate `ADMIN_API_KEY` by updating the variable and redeploying.
14. Create `SESSION_SECRET` with `openssl rand -base64 48`; do not reuse development values.
