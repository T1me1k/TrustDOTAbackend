import { access, cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cwd, stdout } from 'node:process';

const source = resolve(cwd(), 'src', 'db', 'migrations');
const destination = resolve(cwd(), 'dist', 'db', 'migrations');
const sourceJournal = join(source, 'meta', '_journal.json');

try {
  await access(sourceJournal);
} catch (error) {
  throw new Error(`Drizzle migration journal is missing: ${sourceJournal}`, { cause: error });
}

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
await access(join(destination, 'meta', '_journal.json'));

stdout.write(`Copied Drizzle migrations from ${source} to ${destination}\n`);
