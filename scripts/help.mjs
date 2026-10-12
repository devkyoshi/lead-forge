// Prints the Makefile targets that have a `## description` (used by `make help`).
import { readFileSync } from "node:fs";

for (const line of readFileSync("Makefile", "utf8").split(/\r?\n/)) {
  const m = /^([a-zA-Z_-]+):.*?## (.*)$/.exec(line);
  if (m) console.log(`  make ${m[1].padEnd(12)} ${m[2]}`);
}
