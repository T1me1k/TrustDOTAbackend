import { afterEach, describe, expect, it, vi } from 'vitest';

const insertError = new Error('simulated insert failure');
const end = vi.fn().mockResolvedValue(undefined);

vi.mock('../db/client.js', () => ({
  createDatabase: () => ({
    db: { insert: vi.fn(() => { throw insertError; }) },
    pool: { end },
  }),
}));

describe('seed command failure handling', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('sets a non-zero exit code, closes the pool, and never prints success after an insert error', async () => {
    process.env.DATABASE_URL = 'postgres://unused';
    process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters';
    process.env.ADMIN_API_KEY = 'test-admin-api-key-at-least-32-characters';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../db/seed.js');

    await main();

    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith('Database seed failed:', insertError);
    expect(end).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalledWith('Seed completed idempotently');
  });
});
