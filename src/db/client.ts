import pg from 'pg';import { drizzle } from 'drizzle-orm/node-postgres';import * as schema from './schema.js';import type { Env } from '../config/env.js';
export function createDatabase(env:Env){const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:10});return {pool,db:drizzle(pool,{schema})}}
export type Database=ReturnType<typeof createDatabase>['db'];
