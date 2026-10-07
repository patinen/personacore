import { DatabaseSync } from "node:sqlite";
try {
  if (!process.argv[2]) throw new Error("A usage database path is required");
  const db = new DatabaseSync(process.argv[2], { readOnly: true, timeout: 1000 });
  try { console.log(JSON.stringify({ timezone: "Europe/Helsinki", aggregate: db.prepare("SELECT * FROM aggregate_daily ORDER BY day DESC").all() }, null, 2)); }
  finally { db.close(); }
} catch { console.error("Cannot inspect aggregate usage. Supply the configured usage.sqlite path and check volume permissions."); process.exitCode = 1; }
