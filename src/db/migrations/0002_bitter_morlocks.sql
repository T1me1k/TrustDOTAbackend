ALTER TABLE "match_players" ADD COLUMN "connection_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "connection_failure_reason" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "connecting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "in_progress_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "completion_reason" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "completed_by" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "match_players_match_accept_idx" ON "match_players" USING btree ("match_id","accept_status");--> statement-breakpoint
CREATE INDEX "match_players_match_connection_idx" ON "match_players" USING btree ("match_id","connection_status");--> statement-breakpoint
CREATE INDEX "matches_status_deadline_idx" ON "matches" USING btree ("status","accept_deadline");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_events_match_player_reason_uidx" ON "rating_events" USING btree ("match_id","player_id","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "trust_events_match_player_reason_uidx" ON "trust_events" USING btree ("match_id","player_id","reason");--> statement-breakpoint
ALTER TABLE "match_players" DROP CONSTRAINT IF EXISTS "match_players_team_check";--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_team_check" CHECK ("match_players"."team" in ('radiant','dire'));--> statement-breakpoint
ALTER TABLE "match_players" DROP CONSTRAINT IF EXISTS "match_players_accept_check";--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_accept_check" CHECK ("match_players"."accept_status" in ('pending','accepted','declined','timed_out'));--> statement-breakpoint
ALTER TABLE "match_players" DROP CONSTRAINT IF EXISTS "match_players_connection_check";--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_connection_check" CHECK ("match_players"."connection_status" in ('pending','connecting','connected','failed'));--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_status_check";--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_status_check" CHECK ("matches"."status" in ('accepting','ready','connecting','in_progress','completed','cancelled'));--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_winner_check";--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_check" CHECK ("matches"."winner" is null or "matches"."winner" in ('radiant','dire'));--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_score_check";--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_score_check" CHECK ("matches"."radiant_score" >= 0 and "matches"."dire_score" >= 0);--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_version_check";--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_version_check" CHECK ("matches"."version" > 0);