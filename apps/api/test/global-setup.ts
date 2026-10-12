import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://leadforge:leadforge@localhost:5432/postgres";
const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgresql://leadforge:leadforge@localhost:5432/leadforge_test";
const DB_NAME = new URL(TEST_URL).pathname.slice(1);

/** Creates a clean test database and applies every migration to it. */
export default async function setup() {
  if (!/test/i.test(DB_NAME)) throw new Error(`Refusing to reset "${DB_NAME}": the test database name must contain "test"`);

  const admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  } catch (e) {
    throw new Error(`Could not reach PostgreSQL to create the test database. Start it with "make infra".\n${(e as Error).message}`);
  } finally {
    await admin.$disconnect();
  }

  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  execSync("pnpm exec prisma migrate deploy", { cwd: apiDir, env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: "pipe" });
}
