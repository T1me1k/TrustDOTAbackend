import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDatabase } from './client.js';

export async function main(): Promise<void> {
  let failure: unknown;
  const env = loadEnv();
  const { db, pool } = createDatabase(env);

  try {
    const migrationsFolder = resolve(process.cwd(), 'dist', 'db', 'migrations');
    const journalPath = join(migrationsFolder, 'meta', '_journal.json');
    if (!existsSync(journalPath)) {
      throw new Error(`Drizzle migration journal is missing: ${journalPath}`);
    }

    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries?: Array<{ tag?: string; when?: number }>;
    };
    const entries = journal.entries ?? [];
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (
        typeof previous?.when !== 'number'
        || typeof current?.when !== 'number'
        || current.when <= previous.when
      ) {
        throw new Error(
          `Migration journal timestamps must be strictly increasing: ${previous?.tag ?? index - 1} -> ${current?.tag ?? index}`,
        );
      }
    }

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
    console.log('Database migrations completed');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
