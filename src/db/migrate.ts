import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDatabase } from './client.js';
const env=loadEnv();const {db,pool}=createDatabase(env);
const migrationsFolder=['src/db/migrations','dist/db/migrations'].find(existsSync);
if(!migrationsFolder)throw new Error('Drizzle migrations directory not found');
await migrate(db,{migrationsFolder});await pool.end();console.log('Balance migrations completed');
