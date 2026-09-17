-- Accounts deliberately use unique names instead of passwords for this project.
-- Opaque session hashes, roles and farm membership are still enforced on every request.
CREATE TABLE toph.farm_access (
  farm_id uuid PRIMARY KEY REFERENCES toph.farms(id) ON DELETE RESTRICT,
  join_code text NOT NULL UNIQUE CHECK (join_code ~ '^[A-Z0-9]{12}$'),
  is_demo boolean NOT NULL DEFAULT false,
  setup_complete boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE toph.accounts (
  id uuid PRIMARY KEY,
  farm_id uuid NOT NULL REFERENCES toph.farms(id) ON DELETE RESTRICT,
  employee_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  normalized_name text NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 1 AND 160),
  role text NOT NULL CHECK (role IN ('admin', 'worker')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, id),
  UNIQUE (employee_id),
  FOREIGN KEY (farm_id, employee_id) REFERENCES toph.employees(farm_id, id) ON DELETE RESTRICT,
  CHECK ((role = 'admin' AND employee_id IS NULL) OR (role = 'worker' AND employee_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX accounts_one_admin_per_farm ON toph.accounts(farm_id) WHERE role = 'admin';
--> statement-breakpoint
CREATE TABLE toph.account_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES toph.accounts(id) ON DELETE CASCADE,
  client text NOT NULL CHECK (client IN ('web', 'mobile')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX account_sessions_account_idx ON toph.account_sessions(account_id);
--> statement-breakpoint
CREATE TABLE toph.farm_images (
  farm_id uuid PRIMARY KEY REFERENCES toph.farms(id) ON DELETE RESTRICT,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 2097152),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 8192),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE toph.fields ADD COLUMN label text CHECK (label ~ '^[A-Z]$');
--> statement-breakpoint
ALTER TABLE toph.fields ADD COLUMN boundary jsonb CHECK (boundary IS NULL OR (jsonb_typeof(boundary) = 'array' AND jsonb_array_length(boundary) BETWEEN 3 AND 200));
--> statement-breakpoint
CREATE UNIQUE INDEX fields_farm_label_unique ON toph.fields(farm_id, label) WHERE label IS NOT NULL;
--> statement-breakpoint
ALTER TABLE toph.work_logs ADD COLUMN reviewed_by uuid;
--> statement-breakpoint
ALTER TABLE toph.work_logs ADD COLUMN reviewed_at timestamptz;
--> statement-breakpoint
ALTER TABLE toph.work_logs ADD CONSTRAINT work_logs_reviewer_fk FOREIGN KEY (farm_id, reviewed_by) REFERENCES toph.accounts(farm_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
-- The supplied farm remains an explicit sample. No fixture, workspace or work log is changed.
INSERT INTO toph.farm_access (farm_id, join_code, is_demo, setup_complete)
  SELECT id, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), true, true
  FROM toph.farms WHERE id = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
INSERT INTO toph.accounts (id, farm_id, employee_id, name, normalized_name, role)
  SELECT '90000000-0000-4000-8000-000000000001', id, NULL, 'Ranch Admin', 'ranch admin', 'admin'
  FROM toph.farms WHERE id = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
INSERT INTO toph.accounts (id, farm_id, employee_id, name, normalized_name, role, is_active)
  SELECT id, farm_id, id, display_name, lower(regexp_replace(btrim(normalize(display_name, NFKC)), '\s+', ' ', 'g')), 'worker', is_active
  FROM toph.employees WHERE farm_id = '00000000-0000-4000-8000-000000000001';
--> statement-breakpoint
-- Existing realtime anonymous access must never extend to newly-created farms.
DO $$ BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'DROP POLICY IF EXISTS toph_live_updates_receive ON realtime.messages';
    EXECUTE 'CREATE POLICY toph_live_updates_receive ON realtime.messages FOR SELECT TO anon USING (extension = ''broadcast'' AND realtime.topic() = ''toph:farm:00000000-0000-4000-8000-000000000001'')';
  END IF;
END $$;
