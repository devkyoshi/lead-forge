// Frees the API (4000) and web (3000) ports. Cross-platform (used by `make stop`).
import { execSync } from "node:child_process";

const ports = [4000, 3000];
const pids = new Set();
try {
  if (process.platform === "win32") {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
      if (m && ports.includes(Number(m[1]))) pids.add(m[2]);
    }
  } else {
    for (const p of ports) {
      try {
        execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, { encoding: "utf8" })
          .split("\n")
          .filter(Boolean)
          .forEach((x) => pids.add(x));
      } catch {
        /* nothing listening */
      }
    }
  }
} catch (e) {
  console.error("could not list listening ports:", e.message);
}

for (const pid of pids) {
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(Number(pid), "SIGKILL");
    console.log(`stopped process ${pid}`);
  } catch {
    /* already gone */
  }
}
if (!pids.size) console.log("nothing listening on ports 4000 or 3000");
