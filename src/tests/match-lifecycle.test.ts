import {describe,expect,it} from 'vitest';
import {MATCH_TRANSITIONS,assertTransition,calculateTeamElo,validateCompletion} from '../services/match-lifecycle.js';

describe('match lifecycle state machine',()=>{
  it('allows every documented transition',()=>{for(const [from,tos] of Object.entries(MATCH_TRANSITIONS))for(const to of tos)expect(()=>assertTransition(from as any,to)).not.toThrow()});
  it('rejects every other transition with the stable conflict code',()=>{const states=Object.keys(MATCH_TRANSITIONS) as (keyof typeof MATCH_TRANSITIONS)[];for(const from of states)for(const to of states)if(!MATCH_TRANSITIONS[from].includes(to as never)){try{assertTransition(from,to)}catch(error:any){expect(error.statusCode).toBe(409);expect(error.code).toBe('INVALID_MATCH_TRANSITION');continue}throw new Error(`${from} -> ${to} unexpectedly accepted`)}})
});
describe('TRUST Rating team Elo',()=>{
  it('is deterministic, bounded and exactly zero-sum',()=>{const a=calculateTeamElo([1000,1100,1200,1300,1400],[1000,1100,1200,1300,1400],'radiant');expect(a).toEqual(calculateTeamElo([1000,1100,1200,1300,1400],[1000,1100,1200,1300,1400],'radiant'));expect(a.radiantDelta).toBe(16);expect(a.radiantDelta+a.direDelta).toBe(0);expect(Math.abs(a.radiantDelta)).toBeLessThanOrEqual(32)});
  it('gives an upset a larger change',()=>expect(calculateTeamElo([800],[1400],'radiant').radiantDelta).toBeGreaterThan(calculateTeamElo([1400],[800],'radiant').radiantDelta));
});
describe('completion validation',()=>{
  it('accepts a conventional result',()=>expect(()=>validateCompletion({winner:'radiant',radiantScore:42,direScore:31,durationSeconds:2538,reason:'Operator confirmed'})).not.toThrow());
  it('accepts a Dota winner with fewer kills',()=>expect(()=>validateCompletion({winner:'radiant',radiantScore:18,direScore:31,durationSeconds:2538,reason:'Ancient destroyed'})).not.toThrow());
  it('accepts tied kill counts because kills do not decide the winner',()=>expect(()=>validateCompletion({winner:'dire',radiantScore:20,direScore:20,durationSeconds:2538,reason:'Ancient destroyed'})).not.toThrow());
  it.each([
    {winner:'draw',radiantScore:1,direScore:2,durationSeconds:100,reason:'x'},
    {winner:'dire',radiantScore:-1,direScore:2,durationSeconds:100,reason:'x'},
    {winner:'dire',radiantScore:1,direScore:2,durationSeconds:10,reason:'x'},
    {winner:'dire',radiantScore:1,direScore:2,durationSeconds:100,reason:''},
  ] as any[])('rejects invalid result %#',(value)=>expect(()=>validateCompletion(value)).toThrow());
});
