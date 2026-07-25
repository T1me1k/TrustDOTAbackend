import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { ApiError } from '../shared/errors.js';
import {
  type Completion,
  MatchLifecycleService,
  validateCompletion,
} from '../services/match-lifecycle.js';

const ISSUE_TTL_SECONDS = 15 * 60;
const ACTIVE_TTL_SECONDS = 8 * 60 * 60;
const MIN_ISSUE_TTL_SECONDS = 5 * 60;
const MAX_ISSUE_TTL_SECONDS = 30 * 60;
const STEAM_ID64 = /^7656119\d{10}$/;
const EVENT_TYPES = new Set([
  'lobby_created',
  'player_connected',
  'player_disconnected',
  'game_started',
  'game_state',
  'game_ended',
  'diagnostic',
]);

export type GameResultInput = {
  resultId: string;
  winner: 'radiant' | 'dire';
  radiantScore: number;
  direScore: number;
  durationSeconds: number;
  balancePatchVersion?: string | null;
  rosterSteamIds: string[];
};

type ExpectedPlayer = {
  playerId: string;
  steamId64: string;
  personaName: string;
  team: 'radiant' | 'dire';
  role: string;
  rating: number;
};

export function createGameSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashGameSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function sameRoster(expected: string[], received: string[]) {
  const normalize = (values: string[]) => [...new Set(values)].sort();
  return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(received));
}

export function validateGameResult(input: GameResultInput) {
  if (
    typeof input.resultId !== 'string'
    || input.resultId.length < 8
    || input.resultId.length > 128
    || !Array.isArray(input.rosterSteamIds)
    || input.rosterSteamIds.length !== 10
    || input.rosterSteamIds.some((id) => !STEAM_ID64.test(id))
  ) {
    throw new ApiError(400, 'INVALID_GAME_RESULT', 'Result id and the 10-player Steam roster are required');
  }
  validateCompletion({
    winner: input.winner,
    radiantScore: input.radiantScore,
    direScore: input.direScore,
    durationSeconds: input.durationSeconds,
    reason: 'Valve-hosted result pending administrator confirmation',
  });
}

export function registerGameSessionRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  lifecycle: MatchLifecycleService,
) {
  app.post('/v1/admin/matches/:id/game-session', async (req: any) => {
    const requestedTtl = Number(req.body?.ttlSeconds ?? ISSUE_TTL_SECONDS);
    const ttlSeconds = Number.isInteger(requestedTtl)
      ? Math.max(MIN_ISSUE_TTL_SECONDS, Math.min(MAX_ISSUE_TTL_SECONDS, requestedTtl))
      : ISSUE_TTL_SECONDS;
    const token = createGameSessionToken();
    const tokenHash = hashGameSessionToken(token);
    const sessionId = randomUUID();
    const client = await pool.connect();

    try {
      await client.query('begin');
      const match = (await client.query(
        'select * from matches where id=$1 for update',
        [req.params.id],
      )).rows[0];
      if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', 'Match not found');
      if (!['ready', 'connecting', 'in_progress'].includes(match.status)) {
        throw new ApiError(409, 'GAME_SESSION_NOT_ALLOWED', 'Match must be ready, connecting, or in progress');
      }

      const roster = (await client.query(
        `select mp.player_id,mp.team,mp.role,mp.rating_before,p.steam_id,p.display_name,p.is_bot
         from match_players mp
         join players p on p.id=mp.player_id
         where mp.match_id=$1
         order by mp.team,mp.role,p.id`,
        [match.id],
      )).rows;
      if (
        roster.length !== 10
        || roster.filter((p) => p.team === 'radiant').length !== 5
        || roster.filter((p) => p.team === 'dire').length !== 5
        || roster.some((p) => p.is_bot || !STEAM_ID64.test(String(p.steam_id ?? '')))
      ) {
        throw new ApiError(
          409,
          'GAME_SESSION_ROSTER_INVALID',
          'A game session requires 10 real players with linked Steam accounts and 5 players per team',
        );
      }

      const expectedRoster: ExpectedPlayer[] = roster.map((p) => ({
        playerId: p.player_id,
        steamId64: p.steam_id,
        personaName: p.display_name,
        team: p.team,
        role: p.role,
        rating: p.rating_before,
      }));

      await client.query(
        `update game_sessions
         set status='revoked',revoked_at=now(),updated_at=now(),row_version=row_version+1
         where match_id=$1 and status in('issued','active','result_pending')`,
        [match.id],
      );
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const session = (await client.query(
        `insert into game_sessions(
          id,match_id,token_hash,status,verification_mode,expected_roster,
          balance_patch_version,expires_at,created_by
        ) values($1,$2,$3,'issued','unverified_valve_hosted',$4,$5,$6,'admin')
        returning *`,
        [
          sessionId,
          match.id,
          tokenHash,
          JSON.stringify(expectedRoster),
          match.balance_patch_version,
          expiresAt,
        ],
      )).rows[0];
      await client.query(
        `insert into audit_logs(
          actor_type,actor_id,action,entity_type,entity_id,new_value,ip_address
        ) values('admin','bootstrap','game_session.issue','game_session',$1,$2,$3)`,
        [
          session.id,
          {
            matchId: match.id,
            expiresAt,
            verificationMode: session.verification_mode,
          },
          req.ip,
        ],
      );
      await client.query('commit');
      return {
        gameSession: gameSessionDto(session),
        token,
        tokenType: 'Bearer',
        bootstrapPath: '/v1/game-sessions/bootstrap',
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/v1/admin/matches/:id/game-sessions', async (req: any) => {
    const rows = (await pool.query(
      'select * from game_sessions where match_id=$1 order by created_at desc',
      [req.params.id],
    )).rows;
    return { gameSessions: rows.map(gameSessionDto) };
  });

  app.get('/v1/admin/game-sessions/:id', async (req: any) => {
    const session = (await pool.query(
      'select * from game_sessions where id=$1',
      [req.params.id],
    )).rows[0];
    if (!session) throw new ApiError(404, 'GAME_SESSION_NOT_FOUND', 'Game session not found');
    const events = (await pool.query(
      `select event_id,type,payload,created_at
       from game_session_events where session_id=$1 order by created_at`,
      [session.id],
    )).rows;
    return { gameSession: gameSessionDto(session), events };
  });

  app.post('/v1/admin/game-sessions/:id/confirm-result', async (req: any) => {
    const session = (await pool.query(
      'select * from game_sessions where id=$1',
      [req.params.id],
    )).rows[0];
    if (!session) throw new ApiError(404, 'GAME_SESSION_NOT_FOUND', 'Game session not found');
    if (session.status === 'completed') {
      return { gameSession: gameSessionDto(session), idempotent: true };
    }
    if (session.status !== 'result_pending' || !session.result_payload) {
      throw new ApiError(409, 'GAME_RESULT_NOT_PENDING', 'Game session has no result awaiting confirmation');
    }

    const result = session.result_payload as GameResultInput;
    const completion: Completion = {
      winner: result.winner,
      radiantScore: result.radiantScore,
      direScore: result.direScore,
      durationSeconds: result.durationSeconds,
      reason: 'Valve-hosted custom game result confirmed by administrator',
    };
    const match = await lifecycle.complete(session.match_id, completion, req.ip);
    const updated = (await pool.query(
      `update game_sessions
       set status='completed',completed_at=now(),updated_at=now(),row_version=row_version+1
       where id=$1 and status='result_pending'
       returning *`,
      [session.id],
    )).rows[0] ?? session;
    await pool.query(
      `insert into audit_logs(
        actor_type,actor_id,action,entity_type,entity_id,old_value,new_value,ip_address
      ) values('admin','bootstrap','game_session.confirm_result','game_session',$1,$2,$3,$4)`,
      [session.id, { status: session.status }, { status: 'completed', resultId: session.result_id }, req.ip],
    );
    return { gameSession: gameSessionDto(updated), match, idempotent: false };
  });

  app.post('/v1/admin/game-sessions/:id/revoke', async (req: any) => {
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) throw new ApiError(400, 'REVOCATION_REASON_REQUIRED', 'Revocation reason is required');
    const session = (await pool.query(
      `update game_sessions
       set status='revoked',revoked_at=now(),revocation_reason=$2,
           updated_at=now(),row_version=row_version+1
       where id=$1 and status<>'completed'
       returning *`,
      [req.params.id, reason],
    )).rows[0];
    if (!session) {
      const existing = (await pool.query('select status from game_sessions where id=$1', [req.params.id])).rows[0];
      if (!existing) throw new ApiError(404, 'GAME_SESSION_NOT_FOUND', 'Game session not found');
      throw new ApiError(409, 'GAME_SESSION_FINAL', 'Completed game sessions cannot be revoked');
    }
    await pool.query(
      `insert into audit_logs(
        actor_type,actor_id,action,entity_type,entity_id,new_value,ip_address
      ) values('admin','bootstrap','game_session.revoke','game_session',$1,$2,$3)`,
      [session.id, { status: 'revoked', reason }, req.ip],
    );
    return { gameSession: gameSessionDto(session) };
  });

  app.post(
    '/v1/game-sessions/bootstrap',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req: any) => {
      const tokenHash = bearerTokenHash(req);
      const body = req.body ?? {};
      if (body.schemaVersion !== '1' || typeof body.addonId !== 'string') {
        throw new ApiError(400, 'INVALID_BOOTSTRAP', 'schemaVersion 1 and addonId are required');
      }
      const client = await pool.connect();
      try {
        await client.query('begin');
        const session = await lockedTokenSession(client, tokenHash);
        ensureUsableSession(session, ['issued', 'active']);
        if (session.status === 'issued' && new Date(session.expires_at) <= new Date()) {
          throw new ApiError(401, 'GAME_SESSION_EXPIRED', 'Game session token expired before bootstrap');
        }
        const activeUntil = new Date(Date.now() + ACTIVE_TTL_SECONDS * 1000);
        const updated = (await client.query(
          `update game_sessions
           set status='active',bootstrapped_at=coalesce(bootstrapped_at,now()),
               last_heartbeat_at=now(),expires_at=$2,server_metadata=$3,
               updated_at=now(),row_version=row_version+1
           where id=$1 returning *`,
          [
            session.id,
            activeUntil,
            {
              schemaVersion: body.schemaVersion,
              addonId: String(body.addonId).slice(0, 100),
              addonVersion: String(body.addonVersion ?? '').slice(0, 100),
              serverId: String(body.serverId ?? '').slice(0, 200),
            },
          ],
        )).rows[0];
        const match = (await client.query(
          'select id,room_code,region,status,balance_patch_version from matches where id=$1',
          [session.match_id],
        )).rows[0];
        await client.query('commit');
        return {
          gameSession: gameSessionDto(updated),
          match: {
            id: match.id,
            roomCode: match.room_code,
            region: match.region,
            status: match.status,
            balancePatchVersion: match.balance_patch_version,
            roster: updated.expected_roster,
          },
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/v1/game-sessions/:id/heartbeat',
    { config: { rateLimit: { max: 90, timeWindow: '1 minute' } } },
    async (req: any) => {
      const tokenHash = bearerTokenHash(req);
      const state = String(req.body?.state ?? 'unknown').slice(0, 64);
      const session = await tokenSession(pool, req.params.id, tokenHash);
      ensureUsableSession(session, ['active']);
      const updated = (await pool.query(
        `update game_sessions
         set last_heartbeat_at=now(),server_state=$2,heartbeat_payload=$3,
             updated_at=now(),row_version=row_version+1
         where id=$1 returning *`,
        [session.id, state, req.body ?? {}],
      )).rows[0];
      return { gameSession: gameSessionDto(updated), serverTime: new Date().toISOString() };
    },
  );

  app.post(
    '/v1/game-sessions/:id/events',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req: any) => {
      const tokenHash = bearerTokenHash(req);
      const eventId = String(req.body?.eventId ?? '');
      const type = String(req.body?.type ?? '');
      if (eventId.length < 8 || eventId.length > 128 || !EVENT_TYPES.has(type)) {
        throw new ApiError(400, 'INVALID_GAME_EVENT', 'A valid eventId and supported event type are required');
      }
      const session = await tokenSession(pool, req.params.id, tokenHash);
      ensureUsableSession(session, ['active']);
      const inserted = await pool.query(
        `insert into game_session_events(session_id,event_id,type,payload)
         values($1,$2,$3,$4)
         on conflict(session_id,event_id) do nothing
         returning id`,
        [session.id, eventId, type, req.body?.payload ?? {}],
      );
      await pool.query(
        'update game_sessions set last_heartbeat_at=now(),updated_at=now() where id=$1',
        [session.id],
      );
      return { accepted: true, idempotent: inserted.rowCount === 0 };
    },
  );

  app.post(
    '/v1/game-sessions/:id/result',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req: any) => {
      const tokenHash = bearerTokenHash(req);
      const input = req.body as GameResultInput;
      validateGameResult(input);
      const client = await pool.connect();
      try {
        await client.query('begin');
        const session = await lockedTokenSession(client, tokenHash, req.params.id);
        if (['result_pending', 'completed'].includes(session.status)) {
          if (session.result_id === input.resultId) {
            await client.query('commit');
            return { gameSession: gameSessionDto(session), idempotent: true };
          }
          throw new ApiError(409, 'GAME_RESULT_CONFLICT', 'A different result already exists');
        }
        ensureUsableSession(session, ['active']);
        const expected = (session.expected_roster as ExpectedPlayer[]).map((p) => p.steamId64);
        if (!sameRoster(expected, input.rosterSteamIds)) {
          throw new ApiError(409, 'GAME_ROSTER_MISMATCH', 'Reported roster does not match the issued game session');
        }
        if (
          session.balance_patch_version
          && input.balancePatchVersion !== session.balance_patch_version
        ) {
          throw new ApiError(409, 'BALANCE_VERSION_MISMATCH', 'Reported balance version does not match the pinned match version');
        }
        const match = (await client.query(
          'select status from matches where id=$1 for update',
          [session.match_id],
        )).rows[0];
        if (match?.status !== 'in_progress') {
          throw new ApiError(409, 'MATCH_NOT_IN_PROGRESS', 'Only an in-progress match can submit a result');
        }
        const updated = (await client.query(
          `update game_sessions
           set status='result_pending',result_id=$2,result_payload=$3,
               result_submitted_at=now(),last_heartbeat_at=now(),
               updated_at=now(),row_version=row_version+1
           where id=$1 returning *`,
          [session.id, input.resultId, input],
        )).rows[0];
        await client.query(
          `insert into game_session_events(session_id,event_id,type,payload)
           values($1,$2,'game_ended',$3)
           on conflict(session_id,event_id) do nothing`,
          [session.id, input.resultId, input],
        );
        await client.query(
          `insert into audit_logs(
            actor_type,actor_id,action,entity_type,entity_id,new_value
          ) values('system',$1,'game_session.result_submitted','game_session',$1,$2)`,
          [
            session.id,
            {
              resultId: input.resultId,
              verificationMode: session.verification_mode,
              status: 'result_pending',
            },
          ],
        );
        await client.query('commit');
        return {
          gameSession: gameSessionDto(updated),
          idempotent: false,
          ratingApplied: false,
          confirmationRequired: true,
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  );
}

function bearerTokenHash(req: any) {
  const authorization = String(req.headers.authorization ?? '');
  if (!authorization.startsWith('Bearer ')) {
    throw new ApiError(401, 'GAME_SESSION_UNAUTHORIZED', 'Game session bearer token required');
  }
  const token = authorization.slice(7).trim();
  if (token.length < 32 || token.length > 256) {
    throw new ApiError(401, 'GAME_SESSION_UNAUTHORIZED', 'Invalid game session bearer token');
  }
  return hashGameSessionToken(token);
}

async function tokenSession(pool: pg.Pool, id: string, tokenHash: string) {
  const session = (await pool.query(
    'select * from game_sessions where id=$1 and token_hash=$2',
    [id, tokenHash],
  )).rows[0];
  if (!session) throw new ApiError(401, 'GAME_SESSION_UNAUTHORIZED', 'Invalid game session bearer token');
  return session;
}

async function lockedTokenSession(client: pg.PoolClient, tokenHash: string, id?: string) {
  const values = id ? [id, tokenHash] : [tokenHash];
  const query = id
    ? 'select * from game_sessions where id=$1 and token_hash=$2 for update'
    : 'select * from game_sessions where token_hash=$1 for update';
  const session = (await client.query(query, values)).rows[0];
  if (!session) throw new ApiError(401, 'GAME_SESSION_UNAUTHORIZED', 'Invalid game session bearer token');
  return session;
}

function ensureUsableSession(session: any, allowed: string[]) {
  if (!allowed.includes(session.status)) {
    throw new ApiError(409, 'GAME_SESSION_NOT_ACTIVE', `Game session is ${session.status}`);
  }
  if (new Date(session.expires_at) <= new Date()) {
    throw new ApiError(401, 'GAME_SESSION_EXPIRED', 'Game session token expired');
  }
}

function gameSessionDto(session: any) {
  return {
    id: session.id,
    matchId: session.match_id,
    status: session.status,
    verificationMode: session.verification_mode,
    balancePatchVersion: session.balance_patch_version,
    expectedRoster: session.expected_roster,
    serverState: session.server_state,
    serverMetadata: session.server_metadata,
    resultId: session.result_id,
    result: session.result_payload,
    expiresAt: session.expires_at,
    bootstrappedAt: session.bootstrapped_at,
    lastHeartbeatAt: session.last_heartbeat_at,
    resultSubmittedAt: session.result_submitted_at,
    completedAt: session.completed_at,
    revokedAt: session.revoked_at,
    revocationReason: session.revocation_reason,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    rowVersion: session.row_version,
  };
}
