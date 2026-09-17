CREATE TABLE "toph"."workspace_state" (
	"farm_id" uuid PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_state_payload_object" CHECK (jsonb_typeof(payload) = 'object'),
	CONSTRAINT "workspace_state_revision_nonnegative" CHECK (revision >= 0),
	CONSTRAINT "workspace_state_payload_size" CHECK (octet_length(payload::text) <= 1048576)
);
--> statement-breakpoint
ALTER TABLE "toph"."workspace_state" ADD CONSTRAINT "workspace_state_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "toph"."farms"("id") ON DELETE restrict ON UPDATE no action;