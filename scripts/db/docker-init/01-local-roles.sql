-- Bootstrap for the disposable test PostgreSQL container (compose.db.yaml).
-- Runs once, as toph_owner in database toph_test, when the data volume is first created.
-- toph_app is the restricted role the grants tests connect as (TEST_DATABASE_APP_URL).
-- The password is a test-only placeholder.
CREATE ROLE toph_app LOGIN PASSWORD 'toph_app_local_dev_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
