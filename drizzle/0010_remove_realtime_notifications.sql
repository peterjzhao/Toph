-- Open dashboards now poll the API, so database live-update signals are no longer sent.
DROP TRIGGER IF EXISTS work_logs_live_update ON toph.work_logs;
--> statement-breakpoint
DROP TRIGGER IF EXISTS work_log_tags_live_update ON toph.work_log_tags;
--> statement-breakpoint
DROP TRIGGER IF EXISTS employees_live_update ON toph.employees;
--> statement-breakpoint
DROP TRIGGER IF EXISTS fields_live_update ON toph.fields;
--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_state_live_update ON toph.workspace_state;
--> statement-breakpoint
DROP FUNCTION IF EXISTS toph.notify_farm_change();
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS toph_live_updates_receive ON realtime.messages';
  END IF;
END $$;
