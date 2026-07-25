import { describe, it, expect } from 'vitest';
import { loadEnv } from '../config/env.js';
import { allowedRatingRange, assignRoles, balanceTeams, type Candidate } from '../worker/matcher.js';
import { buildApp } from '../app.js';

const env = { NODE_ENV:'test', PORT:'4000', DATABASE_URL:'postgres://u:p@localhost:5432/db', SESSION_SECRET:'x'.repeat(32), ADMIN_API_KEY:'a'.repeat(32), FRONTEND_URL:'http://localhost:3000', CORS_ORIGINS:'http://localhost:3000', ALLOW_DEV_AUTH:'true', MATCHMAKING_ENABLED:'true', MATCHMAKING_BOT_FILL:'true', MATCHER_INTERVAL_MS:'2000', MATCH_FOUND_DELAY_MS:'3000', MATCH_ACCEPT_TIMEOUT_MS:'10000', LOG_LEVEL:'silent' };

describe('env validation', () => {
  it('rejects short secrets', () => expect(() => loadEnv({ ...env, SESSION_SECRET:'short' })).toThrow());
  it('loads safe test env', () => expect(loadEnv(env).PORT).toBe(4000));
});

describe('health endpoint', () => {
  it('returns ok', async () => {
    const pool = { query: async () => ({}), end: async () => {} };
    const app = await buildApp({ env: loadEnv(env), db: { db:{} as any, pool } as any });
    const response = await app.inject('/health');
    expect(response.statusCode).toBe(200);
    expect(response.json().service).toBe('trust-backend');
    await app.close();
  });
});

describe('matchmaking utilities', () => {
  const roles = ['Carry','Mid','Offlane','Soft Support','Hard Support'] as const;
  const candidate = (id:string, selected:[typeof roles[number], ...typeof roles[number][]], rating=1000):Candidate => ({
    playerId:id, rating, trustScore:90, primaryRole:selected[0], roles:selected, regions:['EU West'], joinedAt:new Date(),
  });

  it('expands rating range', () => expect(allowedRatingRange(new Date(0),new Date(10*60000),100,500,20)).toBe(300));

  it('assigns one concrete role from every player selection', () => {
    const candidates = Array.from({length:10}, (_, index) => candidate(String(index), [...roles]));
    const assigned = assignRoles(candidates);
    expect(assigned).toHaveLength(10);
    for (const role of roles) expect(assigned?.filter((item) => item.primaryRole === role)).toHaveLength(2);
    expect(assigned?.every((item) => item.roles?.includes(item.primaryRole))).toBe(true);
  });

  it('returns null when the selected roles cannot fill a valid 5v5', () => {
    const candidates = Array.from({length:10}, (_, index) => candidate(String(index), ['Carry']));
    expect(assignRoles(candidates)).toBeNull();
  });

  it('balances teams with exactly one of every role per side', () => {
    const candidates:Candidate[]=[];
    let index=0;
    for (const role of roles) {
      candidates.push(candidate(String(index++), [role], 1000+index));
      candidates.push(candidate(String(index++), [role], 1000+index));
    }
    const balanced=balanceTeams(candidates,10);
    expect(balanced?.radiant).toHaveLength(5);
    expect(balanced?.dire).toHaveLength(5);
    expect(new Set(balanced?.radiant.map((item) => item.primaryRole))).toHaveLength(5);
  });
});
