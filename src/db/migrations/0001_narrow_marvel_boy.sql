CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "steam_auth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "queue_waiting_idx";--> statement-breakpoint
ALTER TABLE "patches" ALTER COLUMN "title" SET DATA TYPE jsonb USING jsonb_build_object('en', "title");--> statement-breakpoint
ALTER TABLE "patches" ALTER COLUMN "summary" SET DATA TYPE jsonb USING jsonb_build_object('en', "summary");--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "profile_url" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "profile_visibility" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "regions" jsonb;--> statement-breakpoint
UPDATE "players" SET "regions" = jsonb_build_array("region");--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "regions" SET DEFAULT '["EU West"]'::jsonb;--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "regions" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "preferred_role" text;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD COLUMN "regions" jsonb;--> statement-breakpoint
UPDATE "queue_entries" SET "regions" = jsonb_build_array("region");--> statement-breakpoint
ALTER TABLE "queue_entries" ALTER COLUMN "regions" SET NOT NULL;--> statement-breakpoint
UPDATE "queue_entries" SET "status" = 'cancelled', "cancelled_at" = now() WHERE "status" = 'waiting';--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_player_active_idx" ON "sessions" USING btree ("player_id","expires_at") WHERE revoked_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "steam_auth_states_hash_idx" ON "steam_auth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "steam_auth_states_expiry_idx" ON "steam_auth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "matches_region_idx" ON "matches" USING btree ("region");--> statement-breakpoint
CREATE UNIQUE INDEX "players_steam_id_idx" ON "players" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "players_regions_gin_idx" ON "players" USING gin ("regions");--> statement-breakpoint
CREATE INDEX "queue_regions_gin_idx" ON "queue_entries" USING gin ("regions");--> statement-breakpoint
CREATE INDEX "queue_waiting_idx" ON "queue_entries" USING btree ("status","joined_at");--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "region";--> statement-breakpoint
ALTER TABLE "queue_entries" DROP COLUMN "region";--> statement-breakpoint
ALTER TABLE "queue_entries" DROP COLUMN "secondary_role";