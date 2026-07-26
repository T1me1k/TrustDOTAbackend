ALTER TABLE "game_sessions" ALTER COLUMN "match_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "game_sessions" DROP CONSTRAINT IF EXISTS "game_sessions_verification_check";
--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_verification_check" CHECK (
  "verification_mode" IN ('unverified_valve_hosted','development_diagnostic')
);
