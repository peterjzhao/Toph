-- Local development bootstrap for the isolated Toph PostgreSQL container.
-- Executed once by the official postgres image entrypoint when the data volume is
-- first initialized. It runs as the bootstrap superuser (toph_owner) in database toph.
--
-- toph_app is the restricted runtime role used by DATABASE_URL. Its table grants are
-- applied by `npm run db:migrate` after the toph schema exists (see scripts/db/grants.sql).
-- toph_test is the disposable database used only by TEST_DATABASE_URL.
--
-- These passwords are local-only placeholders; hosted databases use their own roles.
CREATE ROLE toph_app LOGIN PASSWORD 'toph_app_local_dev_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE DATABASE toph_test OWNER toph_owner;
