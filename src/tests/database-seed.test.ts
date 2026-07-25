import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/client.js';
import { balanceHeroes } from '../db/schema.js';
import { demoBalanceHeroes, seedDatabase } from '../db/seed.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('database seed integration', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl ?? 'postgres://unused',
    SESSION_SECRET: 'test-session-secret-at-least-32-characters',
    ADMIN_API_KEY: 'test-admin-api-key-at-least-32-characters',
    NODE_ENV: 'test',
  });
  const { db, pool } = createDatabase(env);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await db.delete(balanceHeroes);
  });

  afterAll(async () => pool.end());

  it('seeds an empty database and remains duplicate-free through three runs', async () => {
    for (let run = 1; run <= 3; run += 1) {
      await seedDatabase(db, env);
      const result = await db.execute(sql`
        select count(*)::int as total, count(distinct slug)::int as unique_slugs
        from ${balanceHeroes}
        where ${balanceHeroes.slug} in (${sql.join(demoBalanceHeroes.map((hero) => sql`${hero.slug}`), sql`, `)})
      `);
      expect(result.rows[0]).toEqual({
        total: demoBalanceHeroes.length,
        unique_slugs: demoBalanceHeroes.length,
      });
    }
  });
});
