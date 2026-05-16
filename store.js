const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || __dirname;
const SNAPSHOT_FILE = path.join(DATA_DIR, "tank-state.json");
const SEED_FILE = path.join(__dirname, "seed-state.json");
const DATABASE_URL = process.env.DATABASE_URL || "";

let pool = null;

function usesDatabase() {
  return Boolean(DATABASE_URL);
}

function databasePoolConfig() {
  const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  if (local) return { connectionString: DATABASE_URL };
  const connectionString = DATABASE_URL.replace(/([?&])sslmode=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  return {
    connectionString,
    ssl: { rejectUnauthorized: false }
  };
}

async function init() {
  if (!usesDatabase()) return;
  const { Pool } = require("pg");
  pool = new Pool(databasePoolConfig());
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tank_state (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function normalizePayload(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  return {
    images: Array.isArray(parsed.images) ? parsed.images : [],
    fishes: Array.isArray(parsed.fishes) ? parsed.fishes : [],
    foods: Array.isArray(parsed.foods) ? parsed.foods : [],
    medals: parsed.medals && typeof parsed.medals === "object" ? parsed.medals : {}
  };
}

function isEmptyPayload(payload) {
  if (!payload) return true;
  const hasFish = payload.fishes.length > 0;
  const hasMedals = Object.keys(payload.medals).length > 0;
  return !hasFish && !hasMedals;
}

async function loadFromFile() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return null;
    const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
    if (!raw) return null;
    return normalizePayload(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load snapshot file:", error);
    return null;
  }
}

async function saveToFile(payload) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to write snapshot file:", error);
  }
}

async function loadFromDatabase() {
  if (!pool) return null;
  try {
    const baseResult = await pool.query(
      "SELECT (payload - 'images') AS payload FROM tank_state WHERE id = $1",
      ["main"]
    );
    if (!baseResult.rows.length) return null;

    const normalized = normalizePayload(baseResult.rows[0].payload);
    const images = require("./images");
    const imgResult = await pool.query(
      `SELECT elem AS image
       FROM tank_state,
       LATERAL jsonb_array_elements(COALESCE(payload->'images', '[]'::jsonb)) AS elem
       WHERE id = $1`,
      ["main"]
    );

    normalized.images = [];
    for (const row of imgResult.rows) {
      const img = row.image;
      if (!img || typeof img.id !== "string") continue;
      const src = typeof img.src === "string" ? img.src : "";
      const compressed = src ? await images.compressDataUrl(src) : images.TINY_PLACEHOLDER;
      normalized.images.push({
        id: img.id,
        src: compressed || images.TINY_PLACEHOLDER
      });
    }
    return normalized;
  } catch (error) {
    console.error("Failed to load snapshot from database:", error);
    return null;
  }
}

async function saveToDatabase(payload) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO tank_state (id, payload, updated_at)
       VALUES ('main', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [JSON.stringify(payload)]
    );
  } catch (error) {
    console.error("Failed to save snapshot to database:", error);
  }
}

async function load() {
  if (usesDatabase()) return loadFromDatabase();
  return loadFromFile();
}

async function save(payload) {
  const normalized = normalizePayload(payload);
  if (!normalized) return;
  if (usesDatabase()) await saveToDatabase(normalized);
  else await saveToFile(normalized);
}

function loadSeedFile() {
  try {
    if (!fs.existsSync(SEED_FILE)) return null;
    const raw = fs.readFileSync(SEED_FILE, "utf8");
    if (!raw) return null;
    return normalizePayload(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load seed-state.json:", error);
    return null;
  }
}

function storageLabel() {
  if (usesDatabase()) return "PostgreSQL (DATABASE_URL)";
  return `file (${SNAPSHOT_FILE})`;
}

module.exports = {
  init,
  load,
  save,
  loadSeedFile,
  isEmptyPayload,
  normalizePayload,
  storageLabel,
  SNAPSHOT_FILE
};
