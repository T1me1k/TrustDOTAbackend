import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { DOTA_ROLES, REGIONS } from '../config/constants.js';
import { heroDataSchema } from '../balance/validation.js';
import { createDatabase, type Database } from './client.js';
import {
  balanceHeroes,
  featureFlags,
  patches,
  playerRoles,
  players,
  runtimeConfig,
} from './schema.js';

type HeroData = z.infer<typeof heroDataSchema>;
type BalanceHeroInsert = typeof balanceHeroes.$inferInsert;

const demoData: HeroData = {
  baseStrength: 20,
  strengthGain: 2,
  baseAgility: 20,
  agilityGain: 2,
  baseIntelligence: 20,
  intelligenceGain: 2,
  baseHealth: 120,
  healthRegen: 0.5,
  baseMana: 75,
  manaRegen: 0.5,
  armor: 2,
  magicResistance: 25,
  moveSpeed: 300,
  turnRate: 0.6,
  attackRange: 150,
  baseAttackTime: 1.7,
  attackPoint: 0.3,
  projectileSpeed: 0,
  damageMin: 25,
  damageMax: 30,
  dayVision: 1800,
  nightVision: 800,
  collisionSize: 24,
  customValues: [],
};

export const demoBalanceHeroes = [
  {
    slug: 'trust-vanguard',
    nameEn: 'TRUST Vanguard',
    nameRu: 'Авангард TRUST',
    primaryAttribute: 'strength',
    attackType: 'melee',
    roles: ['Carry'],
    tags: ['demo'],
    status: 'hidden',
    sortOrder: 1000,
    currentData: demoData,
    createdBy: 'seed',
    updatedBy: 'seed',
  },
  {
    slug: 'trust-ranger',
    nameEn: 'TRUST Ranger',
    nameRu: 'Следопыт TRUST',
    primaryAttribute: 'agility',
    attackType: 'ranged',
    roles: ['Carry'],
    tags: ['demo'],
    status: 'hidden',
    sortOrder: 1000,
    currentData: demoData,
    createdBy: 'seed',
    updatedBy: 'seed',
  },
] satisfies BalanceHeroInsert[];

export async function seedDatabase(db: Database, env: ReturnType<typeof loadEnv>): Promise<void> {
  const configs = [
    ['matchmaking_enabled', env.MATCHMAKING_ENABLED, true, 'Allows new queue entries'],
    ['play_button_enabled', true, true, 'Allows Play UI'],
    ['maintenance_enabled', false, true, 'Maintenance flag'],
    ['maintenance_message', '', true, 'Public maintenance text'],
    ['match_size', 10, false, 'Players per match'],
    ['minimum_trust_score', 50, false, 'Minimum trust score'],
    ['initial_rating_range', 150, false, 'Initial rating range'],
    ['maximum_rating_range', 700, false, 'Maximum rating range'],
    ['rating_range_growth_per_minute', 25, false, 'Rating expansion per minute'],
    ['accept_timeout_seconds', Math.floor(env.MATCH_ACCEPT_TIMEOUT_MS / 1000), true, 'Accept timeout'],
    ['bot_fill_enabled', env.DEMO_MATCHMAKING_ENABLED, false, 'Allow demo bot fill'],
  ] as const;

  for (const [key, value, isPublic, description] of configs) {
    await db.insert(runtimeConfig).values({ key, value, description, isPublic }).onConflictDoUpdate({
      target: runtimeConfig.key,
      set: { value, description, isPublic },
    });
  }

  for (const key of ['socket_notifications', 'patch_notes']) {
    await db.insert(featureFlags).values({ key, enabled: true, description: `${key} feature` }).onConflictDoNothing();
  }

  for (let i = 1; i <= 25; i += 1) {
    const role = DOTA_ROLES[i % DOTA_ROLES.length]!;
    const [bot] = await db.insert(players).values({
      steamId: `bot:${i}`,
      displayName: `TRUST Bot ${i}`,
      isBot: true,
      rating: 850 + i * 18,
      trustScore: 70 + (i % 25),
      regions: [REGIONS[i % REGIONS.length]!],
      preferredRole: role,
    }).onConflictDoUpdate({
      target: players.steamId,
      set: { displayName: `TRUST Bot ${i}`, isBot: true },
    }).returning();

    for (const [index, dotaRole] of DOTA_ROLES.entries()) {
      await db.insert(playerRoles).values({
        playerId: bot!.id,
        role: dotaRole,
        priority: dotaRole === role ? 1 : index + 2,
      }).onConflictDoNothing();
    }
  }

  await db.insert(patches).values({
    version: '0.1.0-draft',
    title: { en: 'TRUST Backend Foundation', ru: 'Основа TRUST Backend' },
    summary: { en: 'Initial backend draft.', ru: 'Первая версия backend.' },
    changelog: { en: 'Persistent accounts and matchmaking.', ru: 'Постоянные аккаунты и матчмейкинг.' },
    status: 'draft',
  }).onConflictDoNothing();

  for (const hero of demoBalanceHeroes) {
    await db.insert(balanceHeroes).values(hero).onConflictDoUpdate({
      target: balanceHeroes.slug,
      set: {
        nameEn: hero.nameEn,
        nameRu: hero.nameRu,
        primaryAttribute: hero.primaryAttribute,
        attackType: hero.attackType,
        roles: hero.roles,
        tags: hero.tags,
        status: hero.status,
        sortOrder: hero.sortOrder,
        currentData: hero.currentData,
        updatedBy: hero.updatedBy,
      },
    });
  }
}

export async function main(): Promise<void> {
  let failure: unknown;
  const env = loadEnv();
  const { db, pool } = createDatabase(env);

  try {
    await seedDatabase(db, env);
  } catch (error) {
    failure = error;
    console.error('Database seed failed:', error);
  } finally {
    try {
      await pool.end();
    } catch (closeError) {
      console.error('Failed to close the database pool:', closeError);
      failure ??= closeError;
    }
  }

  if (failure) {
    process.exitCode = 1;
  } else {
    console.log('Seed completed idempotently');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
