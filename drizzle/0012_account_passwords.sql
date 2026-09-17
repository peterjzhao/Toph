-- Accounts gain a password. Only the scrypt hash is stored (see src/server/accounts/password.ts).
-- The column is nullable so this migration stays pure SQL: `npm run db:migrate` hashes each
-- existing account's lowercased first name right after applying it, and a null hash can never log in.
ALTER TABLE "toph"."accounts" ADD COLUMN "password_hash" text;
