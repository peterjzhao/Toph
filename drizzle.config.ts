import { defineConfig } from "drizzle-kit";
import { config as loadDotenv } from "dotenv";

// drizzle-kit does not load .env files itself. Mirror the Next.js precedence for the
// two files used locally (.env.local overrides .env); real environment variables win.
loadDotenv({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  // Only the private application schema is managed; Supabase system schemas are ignored.
  schemaFilter: ["toph"],
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  dbCredentials: {
    // Migrations need DDL privileges: use the owner/migration connection, never DATABASE_URL.
    url: process.env.DATABASE_MIGRATION_URL ?? "",
  },
  verbose: true,
  strict: true,
});
