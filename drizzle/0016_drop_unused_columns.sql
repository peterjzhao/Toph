-- Removes stored values nothing reads any more:
-- - farms.avatar_path: the web header shows the administrator photo saved in Settings.
-- - fields.map_image_path: every field is drawn on its farm's aerial, so a field's map is the farm
--   image whenever the farm has one (src/server/services/dashboard.ts).
-- - work_logs.waveform_peaks: never written; the player draws a recording's waveform from its audio.
--   waveform_peaks_valid existed only for its check constraint.
-- - farm_access.is_sample: retired when Bays Ranch became a regular farm.
-- - The workspace `reports` list: saved reports live in toph.farm_reports.
-- Apply only after the code that stopped reading these is deployed; code from before this
-- release cannot read the database afterwards. The view depends on three of the columns, so it
-- is dropped first and recreated without them.
DROP VIEW "toph"."dashboard_logs";--> statement-breakpoint
ALTER TABLE "toph"."work_logs" DROP CONSTRAINT "work_logs_waveform_peaks_valid";--> statement-breakpoint
ALTER TABLE "toph"."work_logs" DROP COLUMN "waveform_peaks";--> statement-breakpoint
DROP FUNCTION "toph"."waveform_peaks_valid"(jsonb);--> statement-breakpoint
ALTER TABLE "toph"."fields" DROP COLUMN "map_image_path";--> statement-breakpoint
ALTER TABLE "toph"."farms" DROP COLUMN "avatar_path";--> statement-breakpoint
ALTER TABLE "toph"."farm_access" DROP COLUMN "is_sample";--> statement-breakpoint
UPDATE "toph"."workspace_state" SET payload = payload - 'reports' WHERE payload ? 'reports';--> statement-breakpoint
CREATE VIEW "toph"."dashboard_logs" AS (select
  l.id,
  l.farm_id,
  l.employee_id,
  e.display_name as employee_name,
  e.avatar_path as employee_avatar_path,
  l.activity,
  l.work_date,
  l.field_id,
  f.name as field_name,
  l.start_at,
  l.end_at,
  l.summary,
  l.is_new,
  l.recording_path,
  l.recording_duration_seconds,
  l.waveform_asset_path,
  (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label) order by t.normalized_label, t.id), '[]'::jsonb)
    from toph.work_log_tags wt
    join toph.tags t on t.id = wt.tag_id and t.farm_id = wt.farm_id
    where wt.work_log_id = l.id
  ) as tags,
  l.created_at,
  l.updated_at,
  l.details
from toph.work_logs l
join toph.employees e on e.id = l.employee_id and e.farm_id = l.farm_id
join toph.fields f on f.id = l.field_id and f.farm_id = l.farm_id);
