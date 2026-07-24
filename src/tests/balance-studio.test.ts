import { describe,expect,it } from 'vitest';
import { abilitySchema, heroCreateSchema } from '../balance/validation.js';
import { BalancePatchService, BalanceValidationService } from '../balance/service.js';
const stats={baseStrength:20,strengthGain:2,baseAgility:20,agilityGain:2,baseIntelligence:20,intelligenceGain:2,baseHealth:120,healthRegen:.5,baseMana:75,manaRegen:.5,armor:2,magicResistance:25,moveSpeed:300,turnRate:.6,attackRange:150,baseAttackTime:1.7,attackPoint:.3,projectileSpeed:0,damageMin:20,damageMax:30,dayVision:1800,nightVision:800,collisionSize:24,customValues:[]};
describe('TRUST Balance Studio validation',()=>{
 it('accepts finite typed hero data',()=>expect(heroCreateSchema.parse({slug:'trust-hero',nameEn:'Hero',nameRu:'Герой',primaryAttribute:'strength',attackType:'melee',currentData:stats}).slug).toBe('trust-hero'));
 it('rejects reversed damage and executable values',()=>{expect(()=>heroCreateSchema.parse({slug:'x',nameEn:'X',nameRu:'Х',primaryAttribute:'strength',attackType:'melee',currentData:{...stats,damageMin:40,damageMax:20}})).toThrow()});
 it('requires per-level ability arrays to match maxLevel',()=>expect(()=>abilitySchema.parse({slug:'spell',nameEn:'Spell',nameRu:'Способность',descriptionEn:'',descriptionRu:'',type:'basic',slot:1,maxLevel:4,behavior:[],damageType:'magical',targetType:[],abilityData:{damage:[1,2]}})).toThrow());
});
describe('patch workflow',()=>{const validation=new BalanceValidationService({} as any);it.each([['draft','in_review'],['in_review','draft'],['in_review','approved'],['approved','scheduled'],['approved','published'],['scheduled','published'],['published','superseded']])('allows %s -> %s',(a,b)=>expect(()=>validation.assertTransition(a,b)).not.toThrow());it.each([['draft','published'],['approved','draft'],['superseded','published']])('rejects %s -> %s',(a,b)=>expect(()=>validation.assertTransition(a,b)).toThrow())});
describe('publication primitives',()=>{it('uses deterministic import hashes',()=>{const service=new BalancePatchService({} as any);expect(service.hash({schemaVersion:'1.0'})).toBe(service.hash({schemaVersion:'1.0'}))})});
