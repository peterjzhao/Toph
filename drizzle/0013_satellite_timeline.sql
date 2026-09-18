-- Satellite field timeline.
--
-- A farm's aerial raster gains its geographic extent, so the field boundaries already stored
-- normalized ([0,1], origin top-left) against that raster describe real ground. The extent lives
-- here rather than on toph.farms because it describes one specific image: replacing the aerial
-- must replace or clear its extent at the same time.
--
-- extent_source records how far the coordinates can be trusted:
--   capture      the map picker's own bbox                     exact
--   located      an admin framed an existing raster by hand    approximate
--   placeholder  sample data: real coordinates, but not this farm's land
--
-- A null extent is normal and means the farm has no timeline; the map page behaves as before.
ALTER TABLE "toph"."farm_images"
  ADD COLUMN "extent_min_x" double precision,
  ADD COLUMN "extent_min_y" double precision,
  ADD COLUMN "extent_max_x" double precision,
  ADD COLUMN "extent_max_y" double precision,
  ADD COLUMN "extent_source" text;

-- The span bounds match parseImageryBbox and src/server/satellite/extent.ts, so the database,
-- the capture API and the timeline cannot disagree about what a usable extent is.
ALTER TABLE "toph"."farm_images"
  ADD CONSTRAINT "farm_images_extent_complete" CHECK (
    (
      "extent_min_x" IS NULL AND "extent_min_y" IS NULL
      AND "extent_max_x" IS NULL AND "extent_max_y" IS NULL AND "extent_source" IS NULL
    ) OR (
      "extent_min_x" IS NOT NULL AND "extent_min_y" IS NOT NULL
      AND "extent_max_x" IS NOT NULL AND "extent_max_y" IS NOT NULL AND "extent_source" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "farm_images_extent_source_known" CHECK (
    "extent_source" IS NULL OR "extent_source" IN ('capture', 'located', 'placeholder')
  ),
  ADD CONSTRAINT "farm_images_extent_span" CHECK (
    "extent_min_x" IS NULL OR (
      "extent_max_x" - "extent_min_x" BETWEEN 100 AND 40000
      AND "extent_max_y" - "extent_min_y" BETWEEN 100 AND 40000
      AND abs("extent_min_x") <= 20037508.34 AND abs("extent_max_x") <= 20037508.34
      AND abs("extent_min_y") <= 20037508.34 AND abs("extent_max_y") <= 20037508.34
    )
  );

-- Per-field index readings. Rendered frames are not cached here: imagery for a fixed extent and
-- date never changes, so it is served with immutable cache headers instead. These rows are kept
-- because the interface shows the farmer the same numbers the analysis was given.
CREATE TABLE "toph"."field_index_stats" (
  "farm_id" uuid NOT NULL REFERENCES "toph"."farms"("id"),
  "field_id" uuid NOT NULL,
  "image_date" date NOT NULL,
  "index_name" text NOT NULL,
  "mean" double precision NOT NULL,
  "min" double precision NOT NULL,
  "max" double precision NOT NULL,
  "std_dev" double precision NOT NULL,
  -- Share of the field that was cloud-free. Readings below the guard are never stored.
  "valid_fraction" double precision NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "field_index_stats_pkey" PRIMARY KEY ("farm_id", "field_id", "image_date", "index_name"),
  CONSTRAINT "field_index_stats_field_fk" FOREIGN KEY ("farm_id", "field_id")
    REFERENCES "toph"."fields" ("farm_id", "id"),
  CONSTRAINT "field_index_stats_valid_fraction" CHECK ("valid_fraction" >= 0 AND "valid_fraction" <= 1),
  CONSTRAINT "field_index_stats_index_name" CHECK (length(btrim("index_name")) > 0)
);

-- Kept apart from toph.transcription_usage so satellite requests and recording transcription
-- cannot starve each other.
CREATE TABLE "toph"."satellite_usage" (
  "farm_id" uuid PRIMARY KEY REFERENCES "toph"."farms"("id"),
  "minute_start" timestamp with time zone NOT NULL,
  "minute_count" integer NOT NULL,
  "day_start" date NOT NULL,
  "day_count" integer NOT NULL,
  CONSTRAINT "satellite_usage_minute_count_check" CHECK ("minute_count" > 0),
  CONSTRAINT "satellite_usage_day_count_check" CHECK ("day_count" > 0)
);
