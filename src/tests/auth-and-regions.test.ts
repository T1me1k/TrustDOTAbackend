import {describe,expect,it,vi} from 'vitest';
import {joinQueueSchema} from '../shared/validation.js';
import {commonRegions,selectMatchRegion} from '../worker/matcher.js';
import {buildSteamRedirect,sha256,STEAM_ENDPOINT,steamIdFromClaimedId,verifySteamResponse} from '../auth/steam.js';

describe('queue regions',()=>{
  it.each([["EU West"],["EU West","EU East"],["EU West","EU East","SEA"]])('accepts 1-3 regions',(...regions)=>expect(joinQueueSchema.parse({regions,roles:['Mid']}).regions).toEqual(regions));
  it.each([[['Mid']],[['Carry','Mid','Offlane']],[['Carry','Mid','Offlane','Soft Support','Hard Support']]])('accepts 1-5 unique roles',roles=>expect(joinQueueSchema.parse({regions:['EU West'],roles}).roles).toEqual(roles));
  it('accepts the legacy primaryRole during a rolling deploy',()=>expect(joinQueueSchema.parse({regions:['EU West'],primaryRole:'Mid'}).roles).toEqual(['Mid']));
  it('rejects invalid region or role selections',()=>{expect(()=>joinQueueSchema.parse({regions:['EU West','EU East','SEA','US East'],roles:['Mid']})).toThrow();expect(()=>joinQueueSchema.parse({regions:['EU West','EU West'],roles:['Mid']})).toThrow();expect(()=>joinQueueSchema.parse({regions:['EU West'],roles:[]})).toThrow();expect(()=>joinQueueSchema.parse({regions:['EU West'],roles:['Mid','Mid']})).toThrow()});
  it('rejects secondaryRole',()=>expect(()=>joinQueueSchema.parse({regions:['EU West'],roles:['Mid'],secondaryRole:'Carry'})).toThrow());
  it('selects a deterministic intersection',()=>{const candidates=[{regions:['EU East','EU West']},{regions:['EU West','EU East']}];expect(commonRegions(candidates)).toEqual(['EU East','EU West']);expect(selectMatchRegion(candidates)).toBe('EU East')});
});
describe('Steam OpenID security',()=>{
  it('hashes secrets and validates claimed ids',()=>{expect(sha256('state')).toHaveLength(64);expect(steamIdFromClaimedId('https://steamcommunity.com/openid/id/76561198000000000')).toBe('76561198000000000');expect(steamIdFromClaimedId('https://evil.test/76561198000000000')).toBeNull()});
  it('rejects forged callback before contacting Steam',async()=>{const fetcher=vi.fn();expect(await verifySteamResponse({'openid.mode':'id_res','openid.claimed_id':'https://evil.test/id/76561198000000000'},'http://localhost/cb',fetcher)).toBeNull();expect(fetcher).not.toHaveBeenCalled()});
  it('uses the Steam login endpoint for redirects and callback verification',async()=>{
    const returnUrl='https://trustdota.test/auth/steam/callback';
    const state='verified-state';
    const claimedId='https://steamcommunity.com/openid/id/76561198000000000';
    const fetcher=vi.fn().mockResolvedValue(new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'));
    const query={
      'openid.ns':'http://specs.openid.net/auth/2.0',
      'openid.mode':'id_res',
      'openid.op_endpoint':'https://steamcommunity.com/openid/login',
      'openid.claimed_id':claimedId,
      'openid.identity':claimedId,
      'openid.return_to':`${returnUrl}?state=${state}`,
      'openid.response_nonce':'2026-07-24T12:00:00Zunique',
      'openid.assoc_handle':'1234567890',
      'openid.signed':'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
      'openid.sig':'signature',
      state,
    };

    expect(new URL(buildSteamRedirect('https://trustdota.test',returnUrl,state)).origin+new URL(buildSteamRedirect('https://trustdota.test',returnUrl,state)).pathname).toBe(STEAM_ENDPOINT);
    await expect(verifySteamResponse(query,returnUrl,fetcher)).resolves.toBe('76561198000000000');
    expect(fetcher).toHaveBeenCalledWith(STEAM_ENDPOINT,expect.objectContaining({method:'POST'}));
  });
  it('allows a trailing slash but rejects a different OpenID endpoint',async()=>{
    const returnUrl='https://trustdota.test/auth/steam/callback';
    const state='verified-state';
    const claimedId='https://steamcommunity.com/openid/id/76561198000000000';
    const callback={
      'openid.mode':'id_res',
      'openid.op_endpoint':`${STEAM_ENDPOINT}/`,
      'openid.claimed_id':claimedId,
      'openid.identity':claimedId,
      'openid.return_to':`${returnUrl}?state=${state}`,
      state,
    };
    const fetcher=vi.fn().mockResolvedValue(new Response('is_valid:true\n'));

    await expect(verifySteamResponse(callback,returnUrl,fetcher)).resolves.toBe('76561198000000000');
    callback['openid.op_endpoint']='https://steamcommunity.com/openid/other';
    await expect(verifySteamResponse(callback,returnUrl,fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
