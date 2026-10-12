// Creates .env from .env.example when missing. Cross-platform (used by `make env`).
import { copyFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  console.log(".env already exists");
} else {
  copyFileSync(".env.example", ".env");
  console.log("created .env from .env.example");
}
