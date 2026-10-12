import { defineConfig } from "vitest/config";

/**
 * Integration tests: a real PostgreSQL database (leadforge_test, created fresh and migrated by the
 * global setup) with mocked places, AI and email providers. Needs `make infra` running.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://leadforge:leadforge@localhost:5432/leadforge_test",
      REDIS_URL: "redis://localhost:6379",
      API_PUBLIC_URL: "http://localhost:4010",
      WEB_PUBLIC_URL: "http://localhost:3000",
      JWT_SECRET: "test-secret-test-secret-test-secret-test",
      CREDENTIALS_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
      PLACES_PROVIDER: "mock",
      EMAIL_PROVIDER: "console",
      AI_PROVIDER: "mock",
    },
  },
});
