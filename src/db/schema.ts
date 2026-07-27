import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
export type LocalizedText = { en: string; ru?: string };

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  steamId: text('steam_id').unique(),
  displayName: text('display_name').notNull(), avatarUrl: text('avatar_url'), profileUrl: text('profile_url'),
  profileVisibility: integer('profile_visibility'), status: text('status').notNull().default('active'),
  rating: integer('rating').notNull().default(1000), trustScore: integer('trust_score').notNull().default(100),
  regions: jsonb('regions').$type<string[]>().notNull().default(['EU West']), preferredRole: text('preferred_role'), preferredRoles: jsonb('preferred_roles').$type<string[]>().notNull().default(['Mid']),
  isBot: boolean('is_bot').notNull().default(false), createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(), lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (t) => ({ steam: uniqueIndex('players_steam_id_idx').on(t.steamId), status: index('players_status_idx').on(t.status), regions: index('players_regions_gin_idx').using('gin', t.regions), bot: index('players_is_bot_idx').on(t.isBot) }));

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(), playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').notNull(), createdAt: createdAt(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ipAddress: text('ip_address'), userAgent: text('user_agent'),
}, (t) => ({ token: uniqueIndex('sessions_token_hash_idx').on(t.tokenHash), active: index('sessions_player_active_idx').on(t.playerId, t.expiresAt).where(sql`revoked_at is null`) }));

export const steamAuthStates = pgTable('steam_auth_states', {
  id: uuid('id').primaryKey().defaultRandom(), stateHash: text('state_hash').notNull(), createdAt: createdAt(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), usedAt: timestamp('used_at', { withTimezone: true }),
}, (t) => ({ state: uniqueIndex('steam_auth_states_hash_idx').on(t.stateHash), expiry: index('steam_auth_states_expiry_idx').on(t.expiresAt) }));

export const playerRoles = pgTable('player_roles', { playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }).notNull(), role: text('role').notNull(), priority: integer('priority').notNull().default(1) }, (t) => ({ pk: primaryKey({ columns: [t.playerId, t.role] }) }));
export const queueEntries = pgTable('queue_entries', {
  id: uuid('id').primaryKey().defaultRandom(), playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }).notNull(),
  regions: jsonb('regions').$type<string[]>().notNull(), primaryRole: text('primary_role').notNull(), roles: jsonb('roles').$type<string[]>().notNull().default(['Mid']), ratingSnapshot: integer('rating_snapshot').notNull(), trustScoreSnapshot: integer('trust_score_snapshot').notNull(),
  status: text('status').notNull().default('waiting'), joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(), matchedAt: timestamp('matched_at', { withTimezone: true }), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), version: integer('version').notNull().default(1),
}, (t) => ({ active: uniqueIndex('queue_one_active_per_player').on(t.playerId).where(sql`status = 'waiting'`), waiting: index('queue_waiting_idx').on(t.status, t.joinedAt), regions: index('queue_regions_gin_idx').using('gin', t.regions), roles: index('queue_roles_gin_idx').using('gin', t.roles) }));

export const matches = pgTable('matches', { id: uuid('id').primaryKey().defaultRandom(), roomCode: text('room_code').notNull().unique(), region: text('region').notNull(), status: text('status').notNull().default('accepting'), acceptDeadline: timestamp('accept_deadline', { withTimezone: true }).notNull(), readyAt: timestamp('ready_at', { withTimezone: true }), connectingAt: timestamp('connecting_at', { withTimezone: true }), inProgressAt: timestamp('in_progress_at', { withTimezone: true }), startedAt: timestamp('started_at', { withTimezone: true }), completedAt: timestamp('completed_at', { withTimezone: true }), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), winner: text('winner'), radiantScore: integer('radiant_score').notNull().default(0), direScore: integer('dire_score').notNull().default(0), durationSeconds: integer('duration_seconds'), completionReason: text('completion_reason'), completedBy: text('completed_by'), cancellationReason: text('cancellation_reason'), balancePatchId: uuid('balance_patch_id'), balancePatchVersion: text('balance_patch_version'), version: integer('version').notNull().default(1), createdAt: createdAt(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull() }, (t) => ({ status: index('matches_status_idx').on(t.status), statusDeadline: index('matches_status_deadline_idx').on(t.status,t.acceptDeadline), region: index('matches_region_idx').on(t.region), statusCheck: check('matches_status_check', sql`${t.status} in ('accepting','ready','connecting','in_progress','completed','cancelled')`), winnerCheck: check('matches_winner_check', sql`${t.winner} is null or ${t.winner} in ('radiant','dire')`), scoreCheck: check('matches_score_check', sql`${t.radiantScore} >= 0 and ${t.direScore} >= 0`), versionCheck: check('matches_version_check', sql`${t.version} > 0`) }));
export const matchPlayers = pgTable('match_players', { matchId: uuid('match_id').references(() => matches.id, { onDelete: 'cascade' }), playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }).notNull(), team: text('team').notNull(), role: text('role').notNull(), acceptStatus: text('accept_status').notNull().default('pending'), acceptedAt: timestamp('accepted_at', { withTimezone: true }), connectionStatus: text('connection_status').notNull().default('pending'), connectedAt: timestamp('connected_at', { withTimezone: true }), connectionFailureReason: text('connection_failure_reason'), ratingBefore: integer('rating_before').notNull(), ratingAfter: integer('rating_after'), trustScoreBefore: integer('trust_score_before').notNull(), trustScoreAfter: integer('trust_score_after'), joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull() }, (t) => ({ pk: primaryKey({ columns: [t.matchId, t.playerId] }), player: index('match_players_player_idx').on(t.playerId), matchAccept: index('match_players_match_accept_idx').on(t.matchId,t.acceptStatus), matchConnection: index('match_players_match_connection_idx').on(t.matchId,t.connectionStatus), teamCheck: check('match_players_team_check',sql`${t.team} in ('radiant','dire')`), acceptCheck: check('match_players_accept_check',sql`${t.acceptStatus} in ('pending','accepted','declined','timed_out')`), connectionCheck: check('match_players_connection_check',sql`${t.connectionStatus} in ('pending','connecting','connected','failed')`) }));
export const ratingEvents = pgTable('rating_events', { id: uuid('id').primaryKey().defaultRandom(), playerId: uuid('player_id').references(() => players.id).notNull(), matchId: uuid('match_id').references(() => matches.id), reason: text('reason').notNull(), delta: integer('delta').notNull(), valueBefore: integer('value_before').notNull(), valueAfter: integer('value_after').notNull(), createdAt: createdAt() },t=>({idempotency:uniqueIndex('rating_events_match_player_reason_uidx').on(t.matchId,t.playerId,t.reason)}));
export const trustEvents = pgTable('trust_events', { id: uuid('id').primaryKey().defaultRandom(), playerId: uuid('player_id').references(() => players.id).notNull(), matchId: uuid('match_id').references(() => matches.id), reason: text('reason').notNull(), delta: integer('delta').notNull(), valueBefore: integer('value_before').notNull(), valueAfter: integer('value_after').notNull(), createdAt: createdAt() },t=>({idempotency:uniqueIndex('trust_events_match_player_reason_uidx').on(t.matchId,t.playerId,t.reason)}));
export const runtimeConfig = pgTable('runtime_config', { key: text('key').primaryKey(), value: jsonb('value').notNull(), description: text('description').notNull(), isPublic: boolean('is_public').notNull().default(false), updatedBy: text('updated_by').notNull().default('system'), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull() });
export const featureFlags = pgTable('feature_flags', { key: text('key').primaryKey(), enabled: boolean('enabled').notNull().default(false), description: text('description').notNull(), updatedBy: text('updated_by').notNull().default('system'), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull() });
export const patches = pgTable('patches', { id: uuid('id').primaryKey().defaultRandom(), version: text('version').notNull().unique(), title: jsonb('title').$type<LocalizedText>().notNull(), summary: jsonb('summary').$type<LocalizedText>().notNull(), changelog: jsonb('changelog').$type<LocalizedText>().notNull(), status: text('status').notNull().default('draft'), publishedAt: timestamp('published_at', { withTimezone: true }), createdAt: createdAt(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull() });
export const sanctions = pgTable('sanctions', { id: uuid('id').primaryKey().defaultRandom(), playerId: uuid('player_id').references(() => players.id).notNull(), type: text('type').notNull(), reason: text('reason').notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }), createdBy: text('created_by').notNull(), createdAt: createdAt(), revokedAt: timestamp('revoked_at', { withTimezone: true }) }, (t) => ({ active: index('sanctions_active_idx').on(t.playerId, t.revokedAt) }));
export const auditLogs = pgTable('audit_logs', { id: uuid('id').primaryKey().defaultRandom(), actorType: text('actor_type').notNull(), actorId: text('actor_id').notNull(), action: text('action').notNull(), entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(), oldValue: jsonb('old_value'), newValue: jsonb('new_value'), ipAddress: text('ip_address'), createdAt: createdAt() }, (t) => ({ created: index('audit_created_idx').on(t.createdAt) }));


export const gameSessions = pgTable('game_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').references(() => matches.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  status: text('status').notNull().default('issued'),
  verificationMode: text('verification_mode').notNull().default('unverified_valve_hosted'),
  expectedRoster: jsonb('expected_roster').notNull(),
  balancePatchVersion: text('balance_patch_version'),
  serverState: text('server_state'),
  serverMetadata: jsonb('server_metadata').notNull().default({}),
  heartbeatPayload: jsonb('heartbeat_payload').notNull().default({}),
  resultId: text('result_id'),
  resultPayload: jsonb('result_payload'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  bootstrappedAt: timestamp('bootstrapped_at', { withTimezone: true }),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  resultSubmittedAt: timestamp('result_submitted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revocationReason: text('revocation_reason'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  rowVersion: integer('row_version').notNull().default(1),
}, (t) => ({
  token: uniqueIndex('game_sessions_token_hash_idx').on(t.tokenHash),
  result: uniqueIndex('game_sessions_result_id_idx').on(t.resultId).where(sql`${t.resultId} is not null`),
  activeMatch: uniqueIndex('game_sessions_one_active_match_idx').on(t.matchId).where(sql`${t.status} in ('issued','active','result_pending')`),
  statusExpiry: index('game_sessions_status_expiry_idx').on(t.status, t.expiresAt),
  statusCheck: check('game_sessions_status_check', sql`${t.status} in ('issued','active','result_pending','completed','expired','revoked')`),
  verificationCheck: check('game_sessions_verification_check', sql`${t.verificationMode} in ('unverified_valve_hosted','development_diagnostic','development_staging')`),
  rowVersionCheck: check('game_sessions_row_version_check', sql`${t.rowVersion} > 0`),
}));

export const gameSessionEvents = pgTable('game_session_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => gameSessions.id, { onDelete: 'cascade' }).notNull(),
  eventId: text('event_id').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: createdAt(),
}, (t) => ({
  idempotency: uniqueIndex('game_session_events_idempotency_idx').on(t.sessionId, t.eventId),
  timeline: index('game_session_events_timeline_idx').on(t.sessionId, t.createdAt),
  typeCheck: check('game_session_events_type_check', sql`${t.type} in ('lobby_created','player_connected','player_disconnected','game_started','game_state','game_ended','diagnostic')`),
}));

const balanceBase = { id: uuid('id').primaryKey().defaultRandom(), createdAt: createdAt(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull() };
export const balanceHeroes = pgTable('balance_heroes', { ...balanceBase, externalId: text('external_id'), slug: text('slug').notNull().unique(), nameEn: text('name_en').notNull(), nameRu: text('name_ru').notNull(), shortName: text('short_name'), primaryAttribute: text('primary_attribute').notNull(), attackType: text('attack_type').notNull(), roles: text('roles').array().notNull().default([]), tags: text('tags').array().notNull().default([]), portraitUrl: text('portrait_url'), iconUrl: text('icon_url'), status: text('status').notNull().default('active'), sortOrder: integer('sort_order').notNull().default(0), currentData: jsonb('current_data').notNull(), createdBy: text('created_by').notNull(), updatedBy: text('updated_by').notNull(), rowVersion: integer('row_version').notNull().default(1) });
export const balanceAbilities = pgTable('balance_abilities', { ...balanceBase, heroId: uuid('hero_id').references(()=>balanceHeroes.id).notNull(), slug: text('slug').notNull(), nameEn:text('name_en').notNull(), nameRu:text('name_ru').notNull(), descriptionEn:text('description_en').notNull(), descriptionRu:text('description_ru').notNull(), type:text('type').notNull(), slot:integer('slot').notNull(), maxLevel:integer('max_level').notNull(), behavior:text('behavior').array().notNull().default([]), damageType:text('damage_type').notNull(), targetType:text('target_type').array().notNull().default([]), dispelType:text('dispel_type'), piercesDebuffImmunity:boolean('pierces_debuff_immunity').notNull().default(false), iconUrl:text('icon_url'), status:text('status').notNull().default('active'), abilityData:jsonb('ability_data').notNull(), rowVersion:integer('row_version').notNull().default(1) });
export const balanceFacets = pgTable('balance_facets', { ...balanceBase, heroId:uuid('hero_id').references(()=>balanceHeroes.id).notNull(), slug:text('slug').notNull(), nameEn:text('name_en').notNull(),nameRu:text('name_ru').notNull(),descriptionEn:text('description_en').notNull(),descriptionRu:text('description_ru').notNull(),facetData:jsonb('facet_data').notNull(),status:text('status').notNull().default('active'),sortOrder:integer('sort_order').notNull().default(0) });
export const balanceTalents = pgTable('balance_talents', { ...balanceBase, heroId:uuid('hero_id').references(()=>balanceHeroes.id).notNull(),tier:integer('tier').notNull(),side:text('side').notNull(),nameEn:text('name_en').notNull(),nameRu:text('name_ru').notNull(),descriptionEn:text('description_en').notNull(),descriptionRu:text('description_ru').notNull(),talentData:jsonb('talent_data').notNull() });
export const balanceUpgrades = pgTable('balance_upgrades', { ...balanceBase, heroId:uuid('hero_id').references(()=>balanceHeroes.id).notNull(),abilityId:uuid('ability_id').references(()=>balanceAbilities.id),type:text('type').notNull(),nameEn:text('name_en').notNull(),nameRu:text('name_ru').notNull(),descriptionEn:text('description_en').notNull(),descriptionRu:text('description_ru').notNull(),upgradeData:jsonb('upgrade_data').notNull() });
export const balancePatches = pgTable('balance_patches', { ...balanceBase, slug:text('slug').notNull().unique(),version:text('version').notNull().unique(),titleEn:text('title_en').notNull(),titleRu:text('title_ru').notNull(),summaryEn:text('summary_en').notNull(),summaryRu:text('summary_ru').notNull(),status:text('status').notNull().default('draft'),releaseChannel:text('release_channel').notNull().default('test'),scheduledAt:timestamp('scheduled_at',{withTimezone:true}),publishedAt:timestamp('published_at',{withTimezone:true}),supersedesPatchId:uuid('supersedes_patch_id'),rollbackOfPatchId:uuid('rollback_of_patch_id'),createdBy:text('created_by').notNull(),reviewedBy:text('reviewed_by'),approvedBy:text('approved_by'),publishedBy:text('published_by'),rowVersion:integer('row_version').notNull().default(1) });
export const balancePatchEntries = pgTable('balance_patch_entries', { ...balanceBase,patchId:uuid('patch_id').references(()=>balancePatches.id).notNull(),entityType:text('entity_type').notNull(),entityId:uuid('entity_id'),operation:text('operation').notNull(),beforeData:jsonb('before_data'),afterData:jsonb('after_data'),category:text('category').notNull(),titleEn:text('title_en').notNull(),titleRu:text('title_ru').notNull(),descriptionEn:text('description_en').notNull(),descriptionRu:text('description_ru').notNull(),sortOrder:integer('sort_order').notNull().default(0) });
export const balanceSnapshots = pgTable('balance_snapshots', { id:uuid('id').primaryKey().defaultRandom(),patchId:uuid('patch_id').references(()=>balancePatches.id).notNull(),entityType:text('entity_type').notNull(),entityId:uuid('entity_id').notNull(),data:jsonb('data').notNull(),createdAt:createdAt() });
export const balanceImportJobs = pgTable('balance_import_jobs', { id:uuid('id').primaryKey().defaultRandom(),status:text('status').notNull(),schemaVersion:text('schema_version').notNull(),dryRun:boolean('dry_run').notNull(),payloadHash:text('payload_hash').notNull(),totalRows:integer('total_rows').notNull(),validRows:integer('valid_rows').notNull(),invalidRows:integer('invalid_rows').notNull(),errors:jsonb('errors').notNull(),createdBy:text('created_by').notNull(),createdAt:createdAt(),completedAt:timestamp('completed_at',{withTimezone:true}) });
