import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production frontend backend readiness', () => {
  it('keeps a single SIGINT handler and binds Fastify to Railway-compatible host/port', async () => {
    const index = await readFile('src/index.ts', 'utf8');
    expect(index.match(/SIGINT/g)).toHaveLength(2);
    expect(index).toContain("host: '0.0.0.0'");
    expect(index).toContain('port: env.PORT');
  });

  it('has guest auth, queue, match accept/decline, and admin endpoints', async () => {
    const app = await readFile('src/app.ts', 'utf8');
    for (const endpoint of [
      '/v1/auth/guest',
      '/v1/me',
      '/v1/auth/logout',
      '/v1/queue/join',
      '/v1/queue/cancel',
      '/v1/queue/status',
      '/v1/matches/:id/accept',
      '/v1/matches/:id/decline',
      '/v1/admin/dashboard',
    ]) expect(app).toContain(endpoint);
    expect(app).toContain('rateLimit: { max: 10');
    expect(app).toContain('headers.authorization');
    expect(app).toContain('ADMIN_API_KEY');
  });

  it('gates bot fill and matchmaking with env/config flags', async () => {
    const env = await readFile('src/config/env.ts', 'utf8');
    const app = await readFile('src/app.ts', 'utf8');
    expect(env).toContain('GUEST_AUTH_ENABLED');
    expect(env).toContain('DEMO_MATCHMAKING_ENABLED');
    expect(app).toContain('!env.DEMO_MATCHMAKING_ENABLED');
    expect(app).toContain("readCfg(database, 'matchmaking_enabled'");
  });

  it('keeps the complete migration journal', async () => {
    const journal = JSON.parse(await readFile('src/db/migrations/meta/_journal.json', 'utf8'));
    expect(journal.entries.map((entry: { tag: string }) => entry.tag)).toEqual(['0000_initial', '0001_narrow_marvel_boy', '0002_bitter_morlocks', '0003_balance_studio']);
  });

  it('prints the idempotent seed completion message for repeatable seed checks', async () => {
    const seed = await readFile('src/db/seed.ts', 'utf8');
    expect(seed).toContain('onConflictDoUpdate');
    expect(seed).toContain('onConflictDoNothing');
    expect(seed).toContain('Seed completed idempotently');
  });
});
