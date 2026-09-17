-- Explicitly enabled shared demo API. No production authentication is implied.
CREATE TABLE toph.mobile_profiles (
  farm_id uuid NOT NULL REFERENCES toph.farms(id),
  employee_id uuid NOT NULL,
  avatar_url text,
  default_field text NOT NULL,
  default_activity text NOT NULL,
  PRIMARY KEY (farm_id, employee_id),
  CONSTRAINT mobile_profile_photo_size CHECK (octet_length(avatar_url) <= 180000)
);
--> statement-breakpoint
CREATE TABLE toph.mobile_submissions (
  farm_id uuid NOT NULL REFERENCES toph.farms(id),
  employee_id uuid NOT NULL,
  client_draft_id uuid NOT NULL,
  log_id uuid NOT NULL REFERENCES toph.work_logs(id),
  content_hash text NOT NULL,
  notes text NOT NULL,
  treatment jsonb,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, employee_id, client_draft_id),
  UNIQUE (log_id)
);
--> statement-breakpoint
-- Bounded demo media retained transactionally with each log in private PostgreSQL.
-- Large-file production sync will use private object storage and signed uploads.
CREATE TABLE toph.mobile_recordings (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES toph.farms(id),
  log_id uuid NOT NULL REFERENCES toph.work_logs(id),
  position integer NOT NULL CHECK (position >= 0 AND position < 8),
  mime_type text NOT NULL,
  duration_seconds double precision NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 1800),
  bytes bytea NOT NULL CHECK (octet_length(bytes) > 0 AND octet_length(bytes) <= 3800000),
  UNIQUE (log_id, position)
);
