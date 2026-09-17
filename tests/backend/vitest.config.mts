import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

// Backend test runner. Run with: npm run test:backend
// Integration tests connect to TEST_DATABASE_URL only (see helpers/test-env.ts) and run
// serially because they share one disposable test database.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      // `server-only` throws outside the React Server layer; the shim keeps the guard in
      // production modules while letting tests import them directly.
      "server-only": path.join(root, "tests/backend/helpers/server-only-shim.ts"),
    },
  },
  test: {
    root,
    include: ["tests/backend/**/*.test.ts"],
    globalSetup: ["tests/backend/helpers/global-setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: "node",
  },
});
