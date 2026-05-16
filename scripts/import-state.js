#!/usr/bin/env node
const fs = require("node:fs");

const [statePath, baseUrl, adminSecret] = process.argv.slice(2);

if (!statePath || !baseUrl || !adminSecret) {
  console.error(
    "Usage: node scripts/import-state.js <tank-state.json> <app-url> <admin-secret>\n" +
      "Example: node scripts/import-state.js ./tank-state.json https://your-app.onrender.com my-secret"
  );
  process.exit(1);
}

const raw = fs.readFileSync(statePath, "utf8");
const payload = JSON.parse(raw);
const url = new URL("/api/admin/import", baseUrl.replace(/\/$/, ""));

fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Admin-Key": adminSecret
  },
  body: JSON.stringify(payload)
})
  .then(async (res) => {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${res.status} ${text}`);
    }
    console.log(text || "Import complete.");
  })
  .catch((err) => {
    console.error("Import failed:", err.message);
    process.exit(1);
  });
