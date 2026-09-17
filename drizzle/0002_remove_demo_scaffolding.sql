-- Production model: the farm no longer carries demo flags or a pinned reference date, work logs
-- lose the demo recording/waveform provenance columns, and dashboard metrics are computed from
-- the data instead of stored as a snapshot. The view is dropped first because it depends on
-- the removed columns, then recreated without them.
DROP VIEW "toph"."dashboard_logs";--> statement-breakpoint
DROP TABLE "toph"."dashboard_metric_snapshots" CASCADE;--> statement-breakpoint
ALTER TABLE "toph"."work_logs" DROP CONSTRAINT "work_logs_waveform_source_valid";--> statement-breakpoint
ALTER TABLE "toph"."farms" DROP COLUMN "demo_reference_date";--> statement-breakpoint
ALTER TABLE "toph"."farms" DROP COLUMN "is_demo";--> statement-breakpoint
ALTER TABLE "toph"."work_logs" DROP COLUMN "recording_is_demo";--> statement-breakpoint
ALTER TABLE "toph"."work_logs" DROP COLUMN "waveform_source";--> statement-breakpoint
CREATE VIEW "toph"."dashboard_logs" AS (select
  l.id,
  l.farm_id,
  l.employee_id,
  e.display_name as employee_name,
  l.activity,
  l.work_date,
  l.field_id,
  f.name as field_name,
  f.map_image_path as field_map_image_path,
  l.start_at,
  l.end_at,
  l.summary,
  l.is_new,
  l.recording_path,
  l.recording_duration_seconds,
  l.waveform_asset_path,
  l.waveform_peaks,
  (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label) order by t.normalized_label, t.id), '[]'::jsonb)
    from toph.work_log_tags wt
    join toph.tags t on t.id = wt.tag_id and t.farm_id = wt.farm_id
    where wt.work_log_id = l.id
  ) as tags,
  l.created_at,
  l.updated_at
from toph.work_logs l
join toph.employees e on e.id = l.employee_id and e.farm_id = l.farm_id
join toph.fields f on f.id = l.field_id and f.farm_id = l.farm_id);