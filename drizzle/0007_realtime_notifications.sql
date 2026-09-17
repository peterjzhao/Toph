-- Live-update signals for open dashboards, using Supabase Realtime "Broadcast from Database".
-- The payload only names which API to read again: {"v":1,"kind":"dashboard"|"workspace"}.
-- It never carries row data, identifiers, names, or anything about recordings, and no toph
-- table joins a Realtime publication. The message is written inside the changing transaction,
-- so subscribers hear about commits only and a rollback emits nothing.
-- On PostgreSQL without Supabase Realtime (local Docker, tests) the function does nothing.
-- Receiving is a separate, explicit operator step: npm run db:enable-realtime.
CREATE FUNCTION toph.notify_farm_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  kind text := TG_ARGV[0];
  farm uuid;
  marker text;
  sent text;
BEGIN
  IF TG_OP = 'DELETE' THEN farm := OLD.farm_id; ELSE farm := NEW.farm_id; END IF;
  -- One signal per farm and kind per transaction, however many rows or statements change.
  marker := farm::text || ':' || kind || ',';
  sent := coalesce(current_setting('toph.live_update_sent', true), '');
  IF position(marker IN sent) > 0 THEN RETURN NULL; END IF;
  PERFORM set_config('toph.live_update_sent', sent || marker, true);
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN NULL; END IF;
  BEGIN
    PERFORM realtime.send(jsonb_build_object('v', 1, 'kind', kind), 'change', 'toph:farm:' || farm::text, true);
  EXCEPTION WHEN OTHERS THEN
    -- A notification problem must never fail the farm's own write.
    RAISE WARNING 'toph live update not sent: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION toph.notify_farm_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER work_logs_live_update AFTER INSERT OR UPDATE OR DELETE ON toph.work_logs
  FOR EACH ROW EXECUTE FUNCTION toph.notify_farm_change('dashboard');
--> statement-breakpoint
CREATE TRIGGER work_log_tags_live_update AFTER INSERT OR UPDATE OR DELETE ON toph.work_log_tags
  FOR EACH ROW EXECUTE FUNCTION toph.notify_farm_change('dashboard');
--> statement-breakpoint
CREATE TRIGGER employees_live_update AFTER INSERT OR UPDATE OR DELETE ON toph.employees
  FOR EACH ROW EXECUTE FUNCTION toph.notify_farm_change('dashboard');
--> statement-breakpoint
CREATE TRIGGER fields_live_update AFTER INSERT OR UPDATE OR DELETE ON toph.fields
  FOR EACH ROW EXECUTE FUNCTION toph.notify_farm_change('dashboard');
--> statement-breakpoint
CREATE TRIGGER workspace_state_live_update AFTER INSERT OR UPDATE OR DELETE ON toph.workspace_state
  FOR EACH ROW EXECUTE FUNCTION toph.notify_farm_change('workspace');
