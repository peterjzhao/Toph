-- Bays Ranch has eleven employees plus its separate administrator account.
-- Remove only the extra seeded Peter ID; never match other employees by name.
DO $$
DECLARE
  target_farm constant uuid := '00000000-0000-4000-8000-000000000001';
  target_employee constant uuid := '10000000-0000-4000-8000-000000000012';
  current_payload jsonb;
  cleaned_payload jsonb;
  section text;
  reference_key text;
BEGIN
  -- Lock the profile and workspace before checking history or changing the roster.
  PERFORM 1 FROM toph.employees
    WHERE farm_id = target_farm AND id = target_employee FOR UPDATE;
  SELECT payload INTO current_payload FROM toph.workspace_state
    WHERE farm_id = target_farm FOR UPDATE;

  IF EXISTS (SELECT 1 FROM toph.work_logs WHERE farm_id = target_farm AND employee_id = target_employee)
     OR EXISTS (SELECT 1 FROM toph.mobile_submissions WHERE farm_id = target_farm AND employee_id = target_employee) THEN
    RAISE EXCEPTION 'The extra Peter profile has recorded work; preserve or reassign that history before removing the profile.';
  END IF;

  IF current_payload IS NOT NULL THEN
    cleaned_payload := current_payload;
    FOREACH section IN ARRAY ARRAY['employees', 'schedule', 'messages'] LOOP
      reference_key := CASE WHEN section = 'employees' THEN 'id' ELSE 'employeeId' END;
      cleaned_payload := jsonb_set(cleaned_payload, ARRAY[section], (
        SELECT coalesce(jsonb_agg(item ORDER BY position), '[]'::jsonb)
        FROM jsonb_array_elements(current_payload -> section) WITH ORDINALITY AS entries(item, position)
        WHERE item ->> reference_key IS DISTINCT FROM target_employee::text
      ));
    END LOOP;
    IF cleaned_payload IS DISTINCT FROM current_payload THEN
      UPDATE toph.workspace_state
        SET payload = cleaned_payload, revision = revision + 1, updated_at = now()
        WHERE farm_id = target_farm;
    END IF;
  END IF;

  DELETE FROM toph.mobile_profiles WHERE farm_id = target_farm AND employee_id = target_employee;
  DELETE FROM toph.employees WHERE farm_id = target_farm AND id = target_employee;
END $$;
