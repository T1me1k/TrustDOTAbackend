import { describe, expect, it } from 'vitest';
import {
  createGameSessionToken,
  hashGameSessionToken,
  sameRoster,
  validateGameResult,
} from '../game-sessions/routes.js';

const roster = Array.from({ length: 10 }, (_, index) => `7656119${String(index).padStart(10, '0')}`);

describe('game session contract', () => {
  it('creates an opaque token and stores only a deterministic hash', () => {
    const token = createGameSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashGameSessionToken(token)).toHaveLength(64);
    expect(hashGameSessionToken(token)).not.toBe(token);
    expect(hashGameSessionToken(token)).toBe(hashGameSessionToken(token));
  });

  it('compares rosters without trusting order and rejects duplicates', () => {
    expect(sameRoster(roster, [...roster].reverse())).toBe(true);
    expect(sameRoster(roster, [...roster.slice(0, 9), roster[0]!])).toBe(false);
  });

  it('validates a complete ten-player result', () => {
    expect(() => validateGameResult({
      resultId: 'result-0001',
      winner: 'radiant',
      radiantScore: 42,
      direScore: 31,
      durationSeconds: 2518,
      balancePatchVersion: '1.0.0',
      rosterSteamIds: roster,
    })).not.toThrow();
  });

  it('accepts the Ancient winner independently of kill count', () => {
    expect(() => validateGameResult({
      resultId: 'result-0002',
      winner: 'dire',
      radiantScore: 42,
      direScore: 31,
      durationSeconds: 2518,
      rosterSteamIds: roster,
    })).not.toThrow();
  });

  it('rejects a malformed or incomplete Steam roster', () => {
    expect(() => validateGameResult({
      resultId: 'result-0003',
      winner: 'dire',
      radiantScore: 42,
      direScore: 31,
      durationSeconds: 2518,
      rosterSteamIds: roster.slice(0, 9),
    })).toThrow();
  });
});
