# TRUST Dota 2 Backend

First-stage backend for TRUST Dota 2: Fastify REST API, Socket.IO, PostgreSQL/Drizzle schema, runtime configuration, server-side PostgreSQL matchmaking, bootstrap admin API, and Railway-ready deployment. Steam OpenID, Dota API, payments, tournaments, anticheat, ML matchmaking, email, frontend, and admin UI are intentionally left for later stages.

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
- `POST /v1/auth/guest` (MVP guest session, rate limited)
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
- `POST /v1/matches/:id/connection/start` starts **TRUST lobby readiness** (it does not create or claim to create an official Dota lobby)
- `POST /v1/matches/:id/connection/ready`
- `GET /v1/me/state` restores the authoritative active match/queue/idle state
- `GET /v1/me/matches?cursor=<ISO timestamp>&limit=20`

Admin (`Authorization: Bearer <ADMIN_API_KEY>`):
- `GET /v1/admin/dashboard`
- `GET /v1/admin/config`
- `PATCH /v1/admin/config/:key`
- `GET /v1/admin/feature-flags`
- `PATCH /v1/admin/feature-flags/:key`
- `GET /v1/admin/queues`
- `GET /v1/admin/matches`
- `GET /v1/admin/matches/:id`
- `POST /v1/admin/matches/:id/start`
- `POST /v1/admin/matches/:id/complete`
- `POST /v1/admin/matches/:id/cancel`
- `GET /v1/admin/stats?range=24h|7d|30d`
- `GET /v1/admin/audit`

Socket.IO server events: `queue:updated`, `match:found`, `match:acceptance_updated`, `match:ready`, `match:connecting`, `match:connection_updated`, `match:started`, `match:completed`, `match:cancelled`, `rating:updated`, `trust:updated`, `config:updated`, `maintenance:updated`. Rooms are `player:<playerId>`, `match:<matchId>`, and `public-config`.

## Authoritative match lifecycle

The backend is the sole source of match status, result, TRUST Rating and Trust Score. Clients render the normalized DTO and server events; they must never infer a transition or calculate a result locally.

```text
accepting --all accept--> ready --TRUST readiness--> connecting --all connected/admin--> in_progress --admin result--> completed
     |                       |                         |                                      |
     +--decline/timeout------+-connection/admin--------+----------------admin + reason--------+--> cancelled
```

Every critical transition locks the match row with `SELECT ... FOR UPDATE`, runs in one PostgreSQL transaction, and increments `matches.version` using an optimistic version predicate. Unsupported edges return HTTP 409 with `INVALID_MATCH_TRANSITION`. Bots accept automatically and become connected automatically. Timeout/decline penalties and completion rewards use unique immutable event keys, so retries do not apply values twice. Innocent accepted players are requeued with their saved regions and role only when they are active, unsanctioned, not already queued, and not in another active match.

## TRUST Rating and Trust Score

TRUST Rating uses deterministic team Elo. For team-average ratings `Rr` and `Rd`, radiant's expected score is `Er = 1 / (1 + 10^((Rd-Rr)/400))`; the raw change is `32 * (Sr-Er)`, rounded and clamped to `[-32,32]`. Dire receives the exact negative, producing zero-sum team deltas; bots are excluded from persistent updates. `rating_events(match_id, player_id, reason)` prevents double awards.

Trust Score is clamped to 0–100: decline `-2`, accept timeout `-3`, connection failure/abandon `-5`, and a clean successful completion `+1`. Winning or losing does not itself affect Trust Score. Every change has an immutable, uniquely keyed `trust_event`.

## Lifecycle migration and Railway rollout

Migration `0002_bitter_morlocks.sql` adds lifecycle timestamps, result metadata, connection state, optimistic versioning, checks, indexes, and rating/trust idempotency indexes with non-destructive defaults. Deploy schema before application code; never run destructive reset commands against production:

```bash
railway run npm ci
railway run npm run db:migrate
railway run npm run db:seed   # optional, repeatable reference data/bots only
```

Manual E2E: sign in through Steam; join ten users (or explicitly enabled demo bots); accept each match and verify the tenth accept yields `ready`; let the worker enter `connecting`; call each participant's readiness endpoint and verify `in_progress`; complete through the admin endpoint with a coherent score; then verify `/v1/me/state`, history, rating/trust events, dashboard, audit IP/reason, and that repeating the identical completion is idempotent while a different result returns 409. Separately decline one accepting match and let another expire to verify one penalty and safe innocent requeue on repeated worker cycles.

## Curl examples

```bash
curl http://localhost:4000/health
curl -i -c cookies.txt -X POST http://localhost:4000/v1/auth/guest
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
- `DEMO_MATCHMAKING_ENABLED=false` unless demo bot-filled matches are explicitly needed
- `GUEST_AUTH_ENABLED=true` for MVP frontend login
- `CORS_ORIGINS` must contain only trusted Vercel/Railway frontend origins.

## Railway deployment

1. Create a Railway project and add a PostgreSQL service.
2. Link the backend service to the PostgreSQL service and set `DATABASE_URL` from Railway's provided connection string.
3. Add `NODE_ENV=production`, `PORT`, `FRONTEND_URL`, `CORS_ORIGINS`, `SESSION_SECRET`, `ADMIN_API_KEY`, `ALLOW_DEV_AUTH=false`, `GUEST_AUTH_ENABLED=true`, `MATCHMAKING_ENABLED=true`, `MATCHMAKING_BOT_FILL=false`, `DEMO_MATCHMAKING_ENABLED=false`, timing variables, and `LOG_LEVEL=info`.
4. Build command: Dockerfile build (or `npm ci && npm run build`).
5. Start command: `npm start`.
6. Healthcheck path: `/health`.
7. Generate a public Railway domain from the service Settings / Networking page.
8. Add the Vercel URL to `FRONTEND_URL` and `CORS_ORIGINS`.
9. Connect GitHub and deploy through PR/main updates; never push secrets.
10. View logs in Railway Deployments or `railway logs`.
11. Run migrations with `npm run db:migrate` as a one-off Railway command before/with deployment.
12. Keep transparent bot fill disabled in production with `DEMO_MATCHMAKING_ENABLED=false` and `runtime_config.bot_fill_enabled=false`; enable it only for isolated demos.
13. Rotate `ADMIN_API_KEY` by updating the variable and redeploying.
14. Create `SESSION_SECRET` with `openssl rand -base64 48`; do not reuse development values.

## Production frontend notes

- Session tokens are opaque and stored only as hashes; cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax`.
- Queue join/cancel/status, match creation, accept, and decline are persisted in PostgreSQL. The frontend must not submit a `playerId`; the backend derives the player from the signed session cookie.
- `/health` only reports process health. `/ready` verifies PostgreSQL connectivity and required tables without returning secrets.
- Admin APIs accept `ADMIN_API_KEY` only via `Authorization: Bearer ...`; responses must not expose secret environment values.
- Seed is idempotent and should finish with `Seed completed idempotently`; running it repeatedly must not delete production data.


## Steam accounts and persistent sessions

Sessions are stored in PostgreSQL as SHA-256 token hashes. Cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`, and scoped to `/`. Steam login uses OpenID 2.0 server-side verification and the Steam Web API only for public profile metadata. Passwords and API keys are never returned or stored.

### Account and patch endpoints

- `GET /v1/auth/steam/start`, `GET /v1/auth/steam/callback`
- `POST /v1/auth/logout`, `POST /v1/auth/logout-all`
- `GET /v1/me`, `PATCH /v1/me/preferences`, `GET /v1/me/matches`
- `GET /v1/players/:id/profile`, `GET /v1/patches/current`
- Admin: players/details/trust score, sanctions, patches CRUD/publish/archive, config, flags, queues, matches and audit.

Queue join accepts only `{"regions":["EU West","EU East"],"primaryRole":"Mid"}`. One to three unique enabled regions are required; the matcher deterministically chooses one region shared by every participant.

### Railway variables

Set `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_API_KEY`, `STEAM_API_KEY`, `STEAM_REALM=https://trustdotabackend-production.up.railway.app`, `STEAM_RETURN_URL=https://trustdotabackend-production.up.railway.app/v1/auth/steam/callback`, `SESSION_TTL_SECONDS=604800`, `REQUIRE_STEAM_FOR_MATCHMAKING=true`, `GUEST_AUTH_ENABLED=true`, `FRONTEND_URL`, and `CORS_ORIGINS`. Register the exact realm and callback with the deployed service. Never commit their production values.

### Manual Steam check

1. Run migrations, then open `/v1/auth/steam/start` in a browser.
2. Confirm the browser is sent only to `steamcommunity.com/openid`, sign in, and accept.
3. Confirm callback redirects to the configured frontend `/profile` and `GET /v1/me` returns the Steam profile with a session cookie.
4. Reuse the callback URL and confirm it fails with `STEAM_STATE_INVALID`; logout and confirm `/v1/me` returns 401.
