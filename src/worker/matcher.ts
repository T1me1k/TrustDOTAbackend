import { DOTA_ROLES } from '../config/constants.js';
import type { DotaRole } from '../shared/types.js';

export type Candidate = {
  playerId: string;
  rating: number;
  trustScore: number;
  primaryRole: DotaRole;
  roles?: DotaRole[];
  regions: string[];
  joinedAt: Date;
  isBot?: boolean;
};

export function commonRegions(candidates: Pick<Candidate, 'regions'>[]) {
  if (!candidates.length) return [];
  return [...new Set(candidates[0]!.regions)]
    .filter((region) => candidates.every((candidate) => candidate.regions.includes(region)))
    .sort();
}

export function selectMatchRegion(candidates: Pick<Candidate, 'regions'>[]) {
  return commonRegions(candidates)[0] ?? null;
}

export function allowedRatingRange(joinedAt: Date, now: Date, initial: number, max: number, growthPerMinute: number) {
  const waitingMinutes = Math.max(0, (now.getTime() - joinedAt.getTime()) / 60000);
  return Math.min(max, initial + waitingMinutes * growthPerMinute);
}

export function assignRoles(candidates: Candidate[], matchSize = 10): Candidate[] | null {
  if (matchSize !== 10 || candidates.length !== matchSize) return null;
  const capacity = new Map<DotaRole, number>(DOTA_ROLES.map((role) => [role, 2]));
  const assigned = new Map<string, DotaRole>();
  const ordered = [...candidates].sort((a, b) => {
    const roleDiff = choices(a).length - choices(b).length;
    if (roleDiff) return roleDiff;
    const timeDiff = a.joinedAt.getTime() - b.joinedAt.getTime();
    return timeDiff || a.playerId.localeCompare(b.playerId);
  });

  function visit(index: number): boolean {
    if (index === ordered.length) return DOTA_ROLES.every((role) => capacity.get(role) === 0);
    const candidate = ordered[index]!;
    for (const role of choices(candidate)) {
      const remaining = capacity.get(role) ?? 0;
      if (remaining <= 0) continue;
      capacity.set(role, remaining - 1);
      assigned.set(candidate.playerId, role);
      if (visit(index + 1)) return true;
      assigned.delete(candidate.playerId);
      capacity.set(role, remaining);
    }
    return false;
  }

  if (!visit(0)) return null;
  return candidates.map((candidate) => ({ ...candidate, primaryRole: assigned.get(candidate.playerId)! }));
}

export function balanceTeams(candidates: Candidate[], matchSize = 10) {
  const assigned = assignRoles(candidates, matchSize);
  if (!assigned) return null;
  const byRole = new Map<DotaRole, Candidate[]>(DOTA_ROLES.map((role) => [role, []]));
  for (const candidate of assigned) byRole.get(candidate.primaryRole)!.push(candidate);
  const radiant: Candidate[] = [];
  const dire: Candidate[] = [];
  for (const role of DOTA_ROLES) {
    const pool = byRole.get(role)!.sort((a, b) => a.rating - b.rating);
    const low = pool[0]!;
    const high = pool[1]!;
    if (total(radiant) <= total(dire)) {
      radiant.push(high);
      dire.push(low);
    } else {
      radiant.push(low);
      dire.push(high);
    }
  }
  return { radiant, dire, radiantRating: total(radiant), direRating: total(dire) };
}

function choices(candidate: Candidate): DotaRole[] {
  const requested = candidate.roles?.length ? candidate.roles : [candidate.primaryRole];
  return DOTA_ROLES.filter((role) => requested.includes(role));
}

function total(candidates: Candidate[]) {
  return candidates.reduce((sum, candidate) => sum + candidate.rating, 0);
}

export class MatchmakingWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private healthy = true;
  constructor(
    private intervalMs: number,
    private cycle: () => Promise<void>,
    private logger: { info: (object: any, message?: string) => void; error: (object: any, message?: string) => void },
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.run(), this.intervalMs);
    void this.run();
    this.logger.info({ intervalMs: this.intervalMs }, 'matchmaking worker started');
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.cycle();
      this.healthy = true;
    } catch (error) {
      this.healthy = false;
      this.logger.error({ error }, 'matchmaking worker cycle failed');
    } finally {
      this.running = false;
    }
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.logger.info({}, 'matchmaking worker stopped');
  }
  isHealthy() { return this.healthy; }
}
