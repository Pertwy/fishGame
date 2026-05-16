#!/usr/bin/env node
const fs = require("node:fs");

const [baseUrl, adminSecret, outPath = "tank-state.json"] = process.argv.slice(2);

if (!baseUrl || !adminSecret) {
  console.error(
    "Usage: node scripts/export-state.js <app-url> <admin-secret> [output-file]\n" +
      "Example: node scripts/export-state.js https://your-app.onrender.com my-secret ./backup.json"
  );
  process.exit(1);
}

const url = new URL("/api/admin/export", baseUrl.replace(/\/$/, ""));

fetch(url, { headers: { "X-Admin-Key": adminSecret } })
  .then(async (res) => {
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  })
  .then((payload) => {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    const fishCount = Array.isArray(payload.fishes) ? payload.fishes.length : 0;
    console.log(`Saved ${fishCount} fish to ${outPath}`);
  })
  .catch((err) => {
    console.error("Export failed:", err.message);
    process.exit(1);
  });
