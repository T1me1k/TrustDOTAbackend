import { z } from 'zod';

const finite = z.number().finite();
const value = z.union([finite, z.array(finite).max(30)]);
const safeJson = z.unknown().superRefine((input, ctx) => {
  const encoded = JSON.stringify(input);
  if (encoded.length > 100_000) ctx.addIssue({ code: 'custom', message: 'JSON exceeds 100KB' });
  if (/\b(?:eval|Function)\s*\(/.test(encoded)) ctx.addIssue({ code: 'custom', message: 'Executable code is forbidden' });
});
const url = z.string().url().max(2048).nullable().optional();

export const heroDataSchema = z.object({
  baseStrength: finite, strengthGain: finite, baseAgility: finite, agilityGain: finite,
  baseIntelligence: finite, intelligenceGain: finite, baseHealth: finite, healthRegen: finite,
  baseMana: finite, manaRegen: finite, armor: finite, magicResistance: finite,
  moveSpeed: finite, turnRate: finite, attackRange: finite, baseAttackTime: finite,
  attackPoint: finite, projectileSpeed: finite, damageMin: finite, damageMax: finite,
  dayVision: finite, nightVision: finite, collisionSize: finite,
  customValues: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), value: z.union([finite, z.string().max(500), z.boolean()]) })).max(100).default([]),
}).strict().superRefine((v, ctx) => { if (v.damageMin > v.damageMax) ctx.addIssue({ code:'custom', path:['damageMin'], message:'damageMin must not exceed damageMax' }); });

export const heroCreateSchema = z.object({ slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),externalId:z.string().max(100).nullable().optional(),nameEn:z.string().trim().min(1).max(200),nameRu:z.string().trim().min(1).max(200),shortName:z.string().max(100).nullable().optional(),primaryAttribute:z.enum(['strength','agility','intelligence','universal']),attackType:z.enum(['melee','ranged']),roles:z.array(z.string().max(50)).max(20).default([]),tags:z.array(z.string().max(50)).max(50).default([]),portraitUrl:url,iconUrl:url,status:z.enum(['active','disabled','hidden','archived']).default('active'),sortOrder:z.number().int().default(0),currentData:heroDataSchema });
export const heroPatchSchema = heroCreateSchema.partial().extend({ rowVersion:z.number().int().positive() });

export const abilityDataSchema = z.object({ cooldown:value.optional(),manaCost:value.optional(),healthCost:value.optional(),castRange:value.optional(),castPoint:value.optional(),channelTime:value.optional(),radius:value.optional(),duration:value.optional(),damage:value.optional(),charges:value.optional(),chargeRestoreTime:value.optional(),customValues:z.array(z.object({key:z.string().regex(/^[a-z][a-z0-9_]*$/),labelEn:z.string().min(1).max(200),labelRu:z.string().min(1).max(200),unit:z.string().max(30),values:value,descriptionEn:z.string().max(1000).optional(),descriptionRu:z.string().max(1000).optional()})).max(100).default([]) }).strict();
export const abilitySchema = z.object({slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),nameEn:z.string().min(1).max(200),nameRu:z.string().min(1).max(200),descriptionEn:z.string().max(5000),descriptionRu:z.string().max(5000),type:z.enum(['basic','ultimate','innate']),slot:z.number().int().min(0).max(20),maxLevel:z.number().int().min(1).max(30),behavior:z.array(z.string().max(50)).max(20),damageType:z.string().max(50),targetType:z.array(z.string().max(50)).max(20),dispelType:z.string().max(50).nullable().optional(),piercesDebuffImmunity:z.boolean().default(false),iconUrl:url,status:z.enum(['active','disabled','hidden','archived']).default('active'),abilityData:abilityDataSchema}).superRefine((v,ctx)=>{for(const [key,x] of Object.entries(v.abilityData))if(Array.isArray(x)&&key!=='customValues'&&x.length!==v.maxLevel)ctx.addIssue({code:'custom',path:['abilityData',key],message:`must contain ${v.maxLevel} level values`});});
export const patchSchema = z.object({slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),version:z.string().min(1).max(50),titleEn:z.string().min(1).max(200),titleRu:z.string().min(1).max(200),summaryEn:z.string().max(5000),summaryRu:z.string().max(5000),releaseChannel:z.enum(['test','production']).default('test')});
export const entrySchema = z.object({entityType:z.enum(['hero','ability','facet','talent','upgrade','system']),entityId:z.string().uuid().nullable().optional(),operation:z.enum(['create','update','archive','restore']),beforeData:safeJson.nullable().optional(),afterData:safeJson.nullable().optional(),category:z.string().min(1).max(100),titleEn:z.string().min(1).max(200),titleRu:z.string().min(1).max(200),descriptionEn:z.string().max(5000),descriptionRu:z.string().max(5000),sortOrder:z.number().int().default(0)});
export type ValidationIssue={severity:'error'|'warning';code:string;message:string;path?:string};
