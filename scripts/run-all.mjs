// Runs the API, worker and web app together with prefixed output; Ctrl+C stops all of them.
// Cross-platform replacement for shell job control (used by `make dev`).
import { spawn, spawnSync } from "node:child_process";

const procs = [
  { name: "api", color: 36, script: "dev:api" },
  { name: "worker", color: 35, script: "dev:worker" },
  { name: "web", color: 32, script: "dev:web" },
];
const isWin = process.platform === "win32";
const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue;
    // Kill the whole tree: pnpm -> tsx/next -> node.
    if (isWin) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try {
        process.kill(-c.pid, "SIGTERM");
      } catch {
        c.kill("SIGTERM");
      }
    }
  }
  setTimeout(() => process.exit(code), 500);
}

for (const p of procs) {
  // One command string with shell:true on Windows (pnpm is a .cmd shim); plain argv elsewhere.
  const child = isWin
    ? spawn(`pnpm ${p.script}`, { shell: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("pnpm", [p.script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const prefix = `\x1b[${p.color}m[${p.name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) console.log(prefix + l);
    });
  }
  child.on("exit", (code) => {
    if (!stopping) {
      console.log(`${prefix}exited with code ${code}; stopping the others`);
      stopAll(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
console.log("Starting api, worker and web. Press Ctrl+C to stop.");
