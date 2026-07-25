import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cwd, stdout } from 'node:process';

const migrationsDirectory = resolve(cwd(), 'src', 'db', 'migrations');
const journalPath = join(migrationsDirectory, 'meta', '_journal.json');

try {
  await access(journalPath);
} catch (error) {
  throw new Error(`Drizzle migration journal is missing: ${journalPath}`, { cause: error });
}

stdout.write(`Verified Drizzle migrations: ${migrationsDirectory}\n`);
stdout.write(`Verified Drizzle migration journal: ${journalPath}\n`);
