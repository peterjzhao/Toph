import backend from "./vitest.config.mts";

/** Pure unit checks, with no PostgreSQL setup or environment loading. */
export default {
  ...backend,
  test: { ...backend.test, include: ["tests/backend/unit/**/*.test.ts"], globalSetup: [] },
};
