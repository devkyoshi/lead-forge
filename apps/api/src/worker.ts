import "./env.js";

// Queue workers are registered here as pipeline stages land (Phase 2+).
console.log("worker started (no queues registered yet)");
setInterval(() => {}, 1 << 30);
