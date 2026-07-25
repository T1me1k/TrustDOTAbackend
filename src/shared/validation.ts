import { z } from 'zod';
import { DOTA_ROLES, REGIONS } from '../config/constants.js';

export const roleSchema = z.enum(DOTA_ROLES);
export const regionSchema = z.enum(REGIONS);
export const regionsSchema = z.array(regionSchema).min(1).max(3)
  .refine((value) => new Set(value).size === value.length, { message: 'Regions must be unique' });
export const rolesSchema = z.array(roleSchema).min(1).max(DOTA_ROLES.length)
  .refine((value) => new Set(value).size === value.length, { message: 'Roles must be unique' });

const roleSelectionSchema = z.object({
  regions: regionsSchema,
  roles: rolesSchema.optional(),
  primaryRole: roleSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!value.roles?.length && !value.primaryRole) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['roles'], message: 'Select at least one role' });
  }
}).transform((value) => {
  const roles = value.roles?.length ? value.roles : [value.primaryRole!];
  return { regions: value.regions, roles, primaryRole: roles[0]! };
});

export const devAuthSchema = z.object({ displayName: z.string().min(2).max(40) });
export const joinQueueSchema = roleSelectionSchema;
export const preferencesSchema = roleSelectionSchema;
