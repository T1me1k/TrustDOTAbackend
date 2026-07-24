import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID, timingSafeEqual } from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from './config/env.js';
import { SERVICE_NAME, VERSION, SESSION_COOKIE, SESSION_TTL_SECONDS, DOTA_ROLES } from './config/constants.js';
import { createDatabase } from './db/client.js';
import { auditLogs, featureFlags, matchPlayers, matches, players, queueEntries, runtimeConfig, sanctions } from './db/schema.js';
import { ApiError, unauthorized } from './shared/errors.js';
import { devAuthSchema, joinQueueSchema } from './shared/validation.js';
import { allowedRatingRange, balanceTeams, type Candidate } from './worker/matcher.js';

type Database = ReturnType<typeof createDatabase>;
type Deps = { env: Env; db?: Database };
const sessions = new Map<string, string>();
const requiredTables = ['players', 'queue_entries', 'matches', 'match_players', 'runtime_config', 'feature_flags', 'audit_logs'];

export async function buildApp({ env, db: createDb }: Deps) {
  const database = createDb ?? createDatabase(env);
  const app = Fastify({ logger: { level: env.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] }, genReqId: () => randomUUID(), bodyLimit: 1_000_000 });
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  app.decorate('db', database.db);
  app.decorate('pool', database.pool);
  app.decorate('io', null);

  const cookieOptions = () => ({ httpOnly: true, sameSite: env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const, secure: env.NODE_ENV === 'production', signed: true, path: '/', maxAge: SESSION_TTL_SECONDS });
  async function currentPlayer(req: any) { const raw = req.unsignCookie(req.cookies[SESSION_COOKIE] ?? ''); const sid = raw.valid ? raw.value : undefined; const playerId = sid ? sessions.get(sid) : undefined; if (!playerId) return null; const [p] = await database.db.select().from(players).where(eq(players.id, playerId)).limit(1); return p ?? null; }
  async function requirePlayer(req: any) { const p = await currentPlayer(req); if (!p) throw unauthorized(); return p; }
  async function cfg(key: string, fallback: any) { const [r] = await database.db.select().from(runtimeConfig).where(eq(runtimeConfig.key, key)).limit(1); return r?.value ?? fallback; }

  app.setErrorHandler((err, req, rep) => { const e = err instanceof ApiError ? err : new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'); req.log.error({ code: e.code, statusCode: e.statusCode, err: err instanceof ApiError ? undefined : err }, 'request failed'); void rep.status(e.statusCode).send({ error: { code: e.code, message: e.message, requestId: req.id } }); });

  app.get('/health', async () => ({ status: 'ok', service: SERVICE_NAME, version: VERSION, uptime: Math.floor(process.uptime()) }));
  app.get('/ready', async (_req, rep) => { try { await database.pool.query('select 1'); const rows = await database.pool.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`, [requiredTables]); const found = new Set(rows.rows.map((r) => r.table_name)); const missing = requiredTables.filter((t) => !found.has(t)); if (missing.length) throw new Error('missing tables'); return { status: 'ready', database: 'ok', tables: 'ok' }; } catch { rep.status(503); return { status: 'not_ready', database: 'failed' }; } });

  app.post('/v1/auth/dev', async (req, rep) => { if (!env.ALLOW_DEV_AUTH) throw new ApiError(404, 'DEV_AUTH_DISABLED', 'Development authentication is disabled'); const body = devAuthSchema.parse(req.body); const [p] = await database.db.insert(players).values({ steamId: `dev:${body.displayName.toLowerCase()}`, displayName: body.displayName, lastSeenAt: new Date() }).onConflictDoUpdate({ target: players.steamId, set: { displayName: body.displayName, lastSeenAt: new Date() } }).returning(); const sid = randomUUID(); sessions.set(sid, p!.id); rep.setCookie(SESSION_COOKIE, sid, cookieOptions()); return { player: publicPlayer(p!) }; });
  app.post('/v1/auth/guest', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (_req, rep) => { if (!env.GUEST_AUTH_ENABLED) throw new ApiError(404, 'GUEST_AUTH_DISABLED', 'Guest authentication is disabled'); const [p] = await database.db.insert(players).values({ steamId: `guest:${randomUUID()}`, displayName: `Guest ${randomUUID().slice(0, 6)}`, lastSeenAt: new Date() }).returning(); const sid = randomUUID(); sessions.set(sid, p!.id); rep.setCookie(SESSION_COOKIE, sid, cookieOptions()); return { player: publicPlayer(p!) }; });
  app.post('/v1/auth/logout', async (req, rep) => { const raw = req.unsignCookie(req.cookies[SESSION_COOKIE] ?? ''); if (raw.valid && raw.value) sessions.delete(raw.value); rep.clearCookie(SESSION_COOKIE, { path: '/' }); return { ok: true }; });
  app.get('/v1/me', async (req) => ({ player: publicPlayer(await requirePlayer(req)) }));

  app.get('/v1/config/public', async () => ({ config: Object.fromEntries((await database.db.select().from(runtimeConfig).where(eq(runtimeConfig.isPublic, true))).map((r) => [r.key, r.value])) }));
  app.post('/v1/queue/join', async (req) => { const player = await requirePlayer(req); const body = joinQueueSchema.parse(req.body); if (!(await cfg('matchmaking_enabled', env.MATCHMAKING_ENABLED)) || !(await cfg('play_button_enabled', true))) throw new ApiError(503, 'MATCHMAKING_DISABLED', 'Matchmaking is temporarily unavailable'); if (player.trustScore < Number(await cfg('minimum_trust_score', 50))) throw new ApiError(403, 'TRUST_SCORE_TOO_LOW', 'Trust score is too low'); const activeSanction = await database.db.select().from(sanctions).where(and(eq(sanctions.playerId, player.id), sql`revoked_at is null and (expires_at is null or expires_at > now())`)).limit(1); if (activeSanction.length) throw new ApiError(403, 'SANCTION_ACTIVE', 'Active sanction blocks matchmaking'); const activeMatch = await database.db.select().from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(and(eq(matchPlayers.playerId, player.id), sql`matches.status in ('accepting','ready','connecting','in_progress')`)).limit(1); if (activeMatch.length) throw new ApiError(409, 'ACTIVE_MATCH_EXISTS', 'Player already has an active match'); const existing = await database.db.select().from(queueEntries).where(and(eq(queueEntries.playerId, player.id), eq(queueEntries.status, 'waiting'))).limit(1); if (existing[0]) return { queue: existing[0], idempotent: true }; const [entry] = await database.db.insert(queueEntries).values({ playerId: player.id, region: body.region, primaryRole: body.primaryRole, secondaryRole: body.secondaryRole, ratingSnapshot: player.rating, trustScoreSnapshot: player.trustScore }).returning(); app.io?.to(`player:${player.id}`).emit('queue:updated', entry); return { queue: entry }; });
  app.post('/v1/queue/cancel', async (req) => { const player = await requirePlayer(req); const [entry] = await database.db.update(queueEntries).set({ status: 'cancelled', cancelledAt: new Date() }).where(and(eq(queueEntries.playerId, player.id), eq(queueEntries.status, 'waiting'))).returning(); return { cancelled: Boolean(entry), queue: entry ?? null }; });
  app.get('/v1/queue/status', async (req) => { const player = await requirePlayer(req); const [entry] = await database.db.select().from(queueEntries).where(eq(queueEntries.playerId, player.id)).orderBy(desc(queueEntries.joinedAt)).limit(1); const mp = await database.db.select().from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(and(eq(matchPlayers.playerId, player.id), sql`matches.status in ('accepting','ready','connecting','in_progress')`)).limit(1); const match = mp[0] as any; return { queue: entry ?? null, matchId: match?.matches?.id ?? null, waitingSeconds: entry?.status === 'waiting' ? Math.floor((Date.now() - entry.joinedAt.getTime()) / 1000) : 0, currentRatingRange: entry ? allowedRatingRange(entry.joinedAt, new Date(), Number(await cfg('initial_rating_range', 150)), Number(await cfg('maximum_rating_range', 700)), Number(await cfg('rating_range_growth_per_minute', 25))) : 0 }; });
  app.get('/v1/matches/:id', async (req: any) => { const player = await requirePlayer(req); const rows = await database.db.select().from(matchPlayers).where(and(eq(matchPlayers.matchId, req.params.id), eq(matchPlayers.playerId, player.id))).limit(1); if (!rows.length) throw new ApiError(404, 'MATCH_NOT_FOUND', 'Match not found'); const [m] = await database.db.select().from(matches).where(eq(matches.id, req.params.id)); const roster = await database.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, req.params.id)); return { match: m, player: rows[0], players: roster }; });
  async function acceptChange(req: any, status: 'accepted' | 'declined') { const player = await requirePlayer(req); const id = req.params.id; return database.db.transaction(async (tx) => { const [m] = await tx.select().from(matches).where(eq(matches.id, id)).limit(1); if (!m) throw new ApiError(404, 'MATCH_NOT_FOUND', 'Match not found'); const [mp] = await tx.select().from(matchPlayers).where(and(eq(matchPlayers.matchId, id), eq(matchPlayers.playerId, player.id))).limit(1); if (!mp) throw new ApiError(403, 'NOT_MATCH_PARTICIPANT', 'Not a match participant'); if (mp.acceptStatus === status) return { ok: true, idempotent: true }; if (m.acceptDeadline < new Date()) throw new ApiError(409, 'ACCEPT_TIMEOUT', 'Accept deadline expired'); await tx.update(matchPlayers).set({ acceptStatus: status, acceptedAt: status === 'accepted' ? new Date() : null }).where(and(eq(matchPlayers.matchId, id), eq(matchPlayers.playerId, player.id))); if (status === 'declined') await tx.update(matches).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(matches.id, id)); else { const pending = await tx.select().from(matchPlayers).where(and(eq(matchPlayers.matchId, id), sql`accept_status <> 'accepted'`)); if (!pending.length) await tx.update(matches).set({ status: 'ready' }).where(eq(matches.id, id)); } return { ok: true }; }); }
  app.post('/v1/matches/:id/accept', async (req) => acceptChange(req, 'accepted'));
  app.post('/v1/matches/:id/decline', async (req) => acceptChange(req, 'declined'));

  function isAdmin(req: any) { const h = String(req.headers.authorization ?? ''); const token = h.startsWith('Bearer ') ? h.slice(7) : ''; const a = Buffer.from(token); const b = Buffer.from(env.ADMIN_API_KEY); return a.length === b.length && timingSafeEqual(a, b); }
  app.addHook('preHandler', async (req) => { if (req.url.startsWith('/v1/admin') && !isAdmin(req)) throw new ApiError(401, 'ADMIN_UNAUTHORIZED', 'Admin authentication required'); });
  app.get('/v1/admin/dashboard', async () => ({ players: await database.db.select({ count: sql<number>`count(*)` }).from(players), queues: await database.db.select({ count: sql<number>`count(*)` }).from(queueEntries), matches: await database.db.select({ count: sql<number>`count(*)` }).from(matches) }));
  app.get('/v1/admin/config', async () => ({ config: await database.db.select().from(runtimeConfig) }));
  app.patch('/v1/admin/config/:key', async (req: any) => { const [old] = await database.db.select().from(runtimeConfig).where(eq(runtimeConfig.key, req.params.key)); if (!old) throw new ApiError(404, 'CONFIG_NOT_FOUND', 'Config key not found'); const [next] = await database.db.update(runtimeConfig).set({ value: (req.body as any)?.value, updatedBy: 'admin', updatedAt: new Date() }).where(eq(runtimeConfig.key, req.params.key)).returning(); await database.db.insert(auditLogs).values({ actorType: 'admin', actorId: 'bootstrap', action: 'runtime_config.update', entityType: 'runtime_config', entityId: req.params.key, oldValue: old, newValue: next, ipAddress: req.ip }); return { config: next }; });
  app.get('/v1/admin/feature-flags', async () => ({ featureFlags: await database.db.select().from(featureFlags) }));
  app.patch('/v1/admin/feature-flags/:key', async (req: any) => { const [old] = await database.db.select().from(featureFlags).where(eq(featureFlags.key, req.params.key)); const [next] = await database.db.update(featureFlags).set({ enabled: Boolean((req.body as any)?.enabled), updatedBy: 'admin', updatedAt: new Date() }).where(eq(featureFlags.key, req.params.key)).returning(); await database.db.insert(auditLogs).values({ actorType: 'admin', actorId: 'bootstrap', action: 'feature_flag.update', entityType: 'feature_flag', entityId: req.params.key, oldValue: old, newValue: next, ipAddress: req.ip }); return { featureFlag: next }; });
  app.get('/v1/admin/queues', async () => ({ queues: await database.db.select().from(queueEntries).limit(100) }));
  app.get('/v1/admin/matches', async () => ({ matches: await database.db.select().from(matches).limit(100) }));
  app.post('/v1/admin/matches/:id/cancel', async (req: any) => { const [m] = await database.db.update(matches).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(matches.id, req.params.id)).returning(); await database.db.insert(auditLogs).values({ actorType: 'admin', actorId: 'bootstrap', action: 'match.cancel', entityType: 'match', entityId: req.params.id, newValue: m, ipAddress: req.ip }); return { match: m }; });
  app.get('/v1/admin/audit', async () => ({ audit: await database.db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100) }));
  app.addHook('onClose', async () => { await database.pool.end(); });
  return app;
}

export async function runMatchmakingCycle(database: Database, env: Env) {
  const enabled = await readCfg(database, 'matchmaking_enabled', env.MATCHMAKING_ENABLED);
  if (!enabled) return null;
  const waits = await database.db.select().from(queueEntries).where(eq(queueEntries.status, 'waiting')).orderBy(queueEntries.joinedAt).limit(10);
  if (waits.length < 10 && !env.DEMO_MATCHMAKING_ENABLED) return null;
  const botsNeeded = Math.max(0, 10 - waits.length);
  const bots = botsNeeded ? await database.db.select().from(players).where(eq(players.isBot, true)).limit(botsNeeded) : [];
  if (waits.length + bots.length < 10) return null;
  const candidates: Candidate[] = [...waits.map((q) => ({ playerId: q.playerId, rating: q.ratingSnapshot, trustScore: q.trustScoreSnapshot, primaryRole: q.primaryRole as any, secondaryRole: q.secondaryRole as any, joinedAt: q.joinedAt })), ...bots.map((b, i) => ({ playerId: b.id, rating: b.rating, trustScore: b.trustScore, primaryRole: DOTA_ROLES[i % DOTA_ROLES.length] as any, secondaryRole: DOTA_ROLES[(i + 1) % DOTA_ROLES.length] as any, joinedAt: new Date(), isBot: true }))].slice(0, 10);
  const balanced = balanceTeams(candidates, 10); if (!balanced) return null;
  return database.db.transaction(async (tx) => { const [m] = await tx.insert(matches).values({ roomCode: `TRUST-${randomUUID().slice(0, 8)}`, region: waits[0]?.region ?? 'EU West', acceptDeadline: new Date(Date.now() + env.MATCH_ACCEPT_TIMEOUT_MS) }).returning(); const rows = [...balanced.radiant.map((c) => ({ c, team: 'radiant' })), ...balanced.dire.map((c) => ({ c, team: 'dire' }))]; await tx.insert(matchPlayers).values(rows.map(({ c, team }) => ({ matchId: m!.id, playerId: c.playerId, team, role: c.primaryRole, ratingBefore: c.rating, trustScoreBefore: c.trustScore, acceptStatus: c.isBot ? 'accepted' : 'pending', acceptedAt: c.isBot ? new Date() : null }))); if (waits.length) await tx.update(queueEntries).set({ status: 'matched', matchedAt: new Date() }).where(inArray(queueEntries.id, waits.map((w) => w.id))); return m; });
}
async function readCfg(database: Database, key: string, fallback: any) { const [r] = await database.db.select().from(runtimeConfig).where(eq(runtimeConfig.key, key)).limit(1); return r?.value ?? fallback; }
export function attachSocket(app: any, server: any, env: Env) { const io = new SocketIOServer(server, { cors: { origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true }, pingInterval: 25000, pingTimeout: 20000 }); io.on('connection', (s) => { s.join('public-config'); s.on('join:player', (id: string) => s.join(`player:${id}`)); s.on('join:match', (id: string) => s.join(`match:${id}`)); }); app.io = io; return io; }
function publicPlayer(p: any) { return { id: p.id, displayName: p.displayName, avatarUrl: p.avatarUrl, status: p.status, rating: p.rating, trustScore: p.trustScore, region: p.region, isBot: p.isBot }; }
declare module 'fastify' { interface FastifyInstance { io?: SocketIOServer | null } }
