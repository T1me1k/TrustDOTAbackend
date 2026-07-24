import {describe,expect,it,vi} from 'vitest';
import {joinQueueSchema} from '../shared/validation.js';
import {commonRegions,selectMatchRegion} from '../worker/matcher.js';
import {sha256,steamIdFromClaimedId,verifySteamResponse} from '../auth/steam.js';

describe('queue regions',()=>{
  it.each([["EU West"],["EU West","EU East"],["EU West","EU East","SEA"]])('accepts 1-3 regions',(...regions)=>expect(joinQueueSchema.parse({regions,primaryRole:'Mid'}).regions).toEqual(regions));
  it('rejects four and duplicate regions',()=>{expect(()=>joinQueueSchema.parse({regions:['EU West','EU East','SEA','US East'],primaryRole:'Mid'})).toThrow();expect(()=>joinQueueSchema.parse({regions:['EU West','EU West'],primaryRole:'Mid'})).toThrow()});
  it('rejects secondaryRole',()=>expect(()=>joinQueueSchema.parse({regions:['EU West'],primaryRole:'Mid',secondaryRole:'Carry'})).toThrow());
  it('selects a deterministic intersection',()=>{const candidates=[{regions:['EU East','EU West']},{regions:['EU West','EU East']}];expect(commonRegions(candidates)).toEqual(['EU East','EU West']);expect(selectMatchRegion(candidates)).toBe('EU East')});
});
describe('Steam OpenID security',()=>{
  it('hashes secrets and validates claimed ids',()=>{expect(sha256('state')).toHaveLength(64);expect(steamIdFromClaimedId('https://steamcommunity.com/openid/id/76561198000000000')).toBe('76561198000000000');expect(steamIdFromClaimedId('https://evil.test/76561198000000000')).toBeNull()});
  it('rejects forged callback before contacting Steam',async()=>{const fetcher=vi.fn();expect(await verifySteamResponse({'openid.mode':'id_res','openid.claimed_id':'https://evil.test/id/76561198000000000'},'http://localhost/cb',fetcher)).toBeNull();expect(fetcher).not.toHaveBeenCalled()});
});
