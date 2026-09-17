-- Adds an optional image path per employee and exposes it through the dashboard view.
DROP VIEW "toph"."dashboard_logs";--> statement-breakpoint
ALTER TABLE "toph"."employees" ADD COLUMN "avatar_path" text;--> statement-breakpoint
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