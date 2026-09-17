-- Shared farm speech/extraction limits across serverless instances. No audio or transcript retained here.
CREATE TABLE toph.transcription_usage (
  farm_id uuid PRIMARY KEY REFERENCES toph.farms(id),
  minute_start timestamptz NOT NULL,
  minute_count integer NOT NULL CHECK (minute_count > 0),
  day_start date NOT NULL,
  day_count integer NOT NULL CHECK (day_count > 0)
);
