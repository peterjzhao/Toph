-- One structured details object per work log, keyed by the shared log-form catalog
-- (src/contracts/log-form.ts). Additive: earlier application code keeps working.
ALTER TABLE "toph"."work_logs" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "toph"."work_logs" ADD CONSTRAINT "work_logs_details_object" CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 16384);
--> statement-breakpoint
-- Saved mobile treatments become the product/amount/unit details of their log.
UPDATE "toph"."work_logs" l
SET details = jsonb_strip_nulls(s.treatment)
FROM "toph"."mobile_submissions" s
WHERE s.log_id = l.id AND s.farm_id = l.farm_id AND jsonb_typeof(s.treatment) = 'object';
--> statement-breakpoint
-- The summary no longer carries a baked "Treatment: ..." line; it is composed from details on read.
UPDATE "toph"."work_logs" l
SET summary = left(l.summary, length(l.summary) - length(x.suffix))
FROM "toph"."mobile_submissions" s,
  LATERAL (SELECT E'\n\nTreatment: ' || concat_ws(' ', nullif(s.treatment->>'product', ''), s.treatment->>'amount', s.treatment->>'unit') AS suffix) x
WHERE s.log_id = l.id AND s.farm_id = l.farm_id AND jsonb_typeof(s.treatment) = 'object'
  AND right(l.summary, length(x.suffix)) = x.suffix AND length(l.summary) > length(x.suffix);
--> statement-breakpoint
-- New trailing column only, so the view is replaced in place and keeps its grants.
CREATE OR REPLACE VIEW "toph"."dashboard_logs" AS (select
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
  l.updated_at,
  l.details
from toph.work_logs l
join toph.employees e on e.id = l.employee_id and e.farm_id = l.farm_id
join toph.fields f on f.id = l.field_id and f.farm_id = l.farm_id);
