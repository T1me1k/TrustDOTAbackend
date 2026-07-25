import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDatabase } from './client.js';

export async function main(): Promise<void> {
  let failure: unknown;
  const env = loadEnv();
  const { db, pool } = createDatabase(env);

  try {
    const migrationsFolder = ['dist/db/migrations', 'src/db/migrations'].find(existsSync);
    if (!migrationsFolder) throw new Error('Drizzle migrations directory not found');
    await migrate(db, { migrationsFolder });
  } catch (error) {
    failure = error;
    console.error('Database migration failed:', error);
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
    console.log('Balance migrations completed');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
