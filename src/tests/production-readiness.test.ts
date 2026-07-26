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
    const gameSessionRoutes = await readFile('src/game-sessions/routes.ts', 'utf8');
    const registeredRoutes = `${app}\n${gameSessionRoutes}`;
    const endpoints = [
      '/v1/auth/guest',
      '/v1/me',
      '/v1/auth/logout',
      '/v1/queue/join',
      '/v1/queue/cancel',
      '/v1/queue/status',
      '/v1/matches/:id/accept',
      '/v1/matches/:id/decline',
      '/v1/admin/dashboard',
      '/v1/game-sessions/bootstrap',
      '/v1/admin/matches/:id/game-session',
    ];
    for (const endpoint of endpoints) {
      expect(registeredRoutes).toContain(endpoint);
    }
    expect(app).toContain('rateLimit: { max: 10');
    expect(app).toContain('headers.authorization');
    expect(app).toContain('ADMIN_API_KEY');
    expect(app).toContain("new ApiError(400, 'VALIDATION_ERROR'");
    expect(app).toContain('err instanceof ZodError');
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
    expect(journal.entries.map((entry: { tag: string }) => entry.tag)).toEqual([
      '0000_initial',
      '0001_narrow_marvel_boy',
      '0002_bitter_morlocks',
      '0003_balance_studio',
      '0004_game_sessions',
      '0005_multi_role_matchmaking',
      '0006_diagnostic_game_sessions',
    ]);
  });

  it('prints the idempotent seed completion message for repeatable seed checks', async () => {
    const seed = await readFile('src/db/seed.ts', 'utf8');
    expect(seed).toContain('onConflictDoUpdate');
    expect(seed).toContain('onConflictDoNothing');
    expect(seed).toContain('Seed completed idempotently');
    expect(seed).toContain('db.insert(balanceHeroes)');
    expect(seed).not.toMatch(/db\.execute\(\s*\{\s*sql/);
  });

  it('uses compiled production database commands and packages migrations', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
    expect(packageJson.scripts['db:migrate']).toBe('node dist/db/migrate.js');
    expect(packageJson.scripts['db:seed']).toBe('node dist/db/seed.js');
    expect(packageJson.scripts['db:migrate:dev']).toBe('tsx src/db/migrate.ts');
    expect(packageJson.scripts['db:seed:dev']).toBe('tsx src/db/seed.ts');
    expect(packageJson.scripts.build).toContain('node scripts/copy-migrations.mjs');

    const dockerfile = await readFile('Dockerfile', 'utf8');
    expect(dockerfile).toContain('COPY scripts ./scripts');
    expect(dockerfile).toContain('npm ci --omit=dev');
    expect(dockerfile).toContain('COPY --from=build /app/dist ./dist');
    expect(dockerfile).toContain('RUN test -f /app/dist/db/migrations/meta/_journal.json');
  });
});
