CREATE TABLE IF NOT EXISTS "game_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "match_id" uuid NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "status" text DEFAULT 'issued' NOT NULL,
  "verification_mode" text DEFAULT 'unverified_valve_hosted' NOT NULL,
  "expected_roster" jsonb NOT NULL,
  "balance_patch_version" text,
  "server_state" text,
  "server_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "heartbeat_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_id" text,
  "result_payload" jsonb,
  "expires_at" timestamp with time zone NOT NULL,
  "bootstrapped_at" timestamp with time zone,
  "last_heartbeat_at" timestamp with time zone,
  "result_submitted_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revocation_reason" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "game_sessions_status_check" CHECK (
    "status" IN ('issued','active','result_pending','completed','expired','revoked')
  ),
  CONSTRAINT "game_sessions_verification_check" CHECK (
    "verification_mode" IN ('unverified_valve_hosted')
  ),
  CONSTRAINT "game_sessions_row_version_check" CHECK ("row_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "game_sessions_token_hash_idx"
  ON "game_sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "game_sessions_result_id_idx"
  ON "game_sessions" USING btree ("result_id")
  WHERE "result_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "game_sessions_one_active_match_idx"
  ON "game_sessions" USING btree ("match_id")
  WHERE "status" IN ('issued','active','result_pending');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_sessions_status_expiry_idx"
  ON "game_sessions" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_session_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
  "event_id" text NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "game_session_events_type_check" CHECK (
    "type" IN (
      'lobby_created','player_connected','player_disconnected',
      'game_started','game_state','game_ended','diagnostic'
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "game_session_events_idempotency_idx"
  ON "game_session_events" USING btree ("session_id","event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_session_events_timeline_idx"
  ON "game_session_events" USING btree ("session_id","created_at");
