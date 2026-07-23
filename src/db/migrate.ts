import { migrate } from 'drizzle-orm/node-postgres/migrator';import { loadEnv } from '../config/env.js';import { createDatabase } from './client.js';
const env=loadEnv();const {db,pool}=createDatabase(env);await migrate(db,{migrationsFolder:'src/db/migrations'});await pool.end();
