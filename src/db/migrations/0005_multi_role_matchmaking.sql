ALTER TABLE "players"
  ADD COLUMN IF NOT EXISTS "preferred_roles" jsonb NOT NULL DEFAULT '["Mid"]'::jsonb;

UPDATE "players"
SET "preferred_roles" = jsonb_build_array("preferred_role")
WHERE "preferred_role" IS NOT NULL
  AND ("preferred_roles" IS NULL OR "preferred_roles" = '[]'::jsonb OR "preferred_roles" = '["Mid"]'::jsonb);

ALTER TABLE "queue_entries"
  ADD COLUMN IF NOT EXISTS "roles" jsonb NOT NULL DEFAULT '["Mid"]'::jsonb;

UPDATE "queue_entries"
SET "roles" = jsonb_build_array("primary_role")
WHERE "primary_role" IS NOT NULL
  AND ("roles" IS NULL OR "roles" = '[]'::jsonb OR "roles" = '["Mid"]'::jsonb);

CREATE INDEX IF NOT EXISTS "queue_roles_gin_idx" ON "queue_entries" USING gin ("roles");
