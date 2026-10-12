import { defineConfig } from "vitest/config";

// Unit tests must not need a .env or running services: give the env validator safe dummy values.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      JWT_SECRET: "test-secret-test-secret-test-secret-test",
      CREDENTIALS_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
    },
  },
});
