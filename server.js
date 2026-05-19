const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { WebSocketServer } = require("ws");
const store = require("./store");
const images = require("./images");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const SAND_HEIGHT_RATIO = 0.26;
const FISH_SIZE = { w: 72 * 0.82, h: 44 * 0.82 };

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

const state = {
  images: [],
  fishes: [],
  foods: [],
  medals: {},
  fight: {
    phase: "idle",
    endsAt: 0,
    nextFoodAt: 0,
    foodIntervalMs: 2000,
    eatCounts: {},
    results: []
  }
};

function id(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function fishDisplayName(fish) {
  const n = fish?.name;
  if (typeof n === "string" && n.trim()) return n.trim();
  return `Fish ${String(fish?.id || "").slice(-6)}`;
}

function swimRect() {
  const sandReserve = WORLD_HEIGHT * SAND_HEIGHT_RATIO + 14;
  const maxY = Math.max(12, WORLD_HEIGHT - FISH_SIZE.h - sandReserve);
  const maxX = Math.max(0, WORLD_WIDTH - FISH_SIZE.w);
  return { minX: 0, maxX, minY: 10, maxY };
}

function randomSwimTarget() {
  const r = swimRect();
  const loX = r.minX;
  const hiX = r.maxX;
  const loY = Math.min(r.minY + 8, r.maxY);
  const hiY = r.maxY;
  return {
    x: hiX > loX ? rand(loX, hiX) : (r.minX + r.maxX) * 0.5,
    y: hiY > loY ? rand(loY, hiY) : (r.minY + r.maxY) * 0.5
  };
}

function swimTargetIsInvalid(target) {
  if (!target) return true;
  const r = swimRect();
  return target.x < r.minX || target.x > r.maxX || target.y < r.minY || target.y > r.maxY;
}

function getImageById(imageId) {
  return state.images.find((img) => img.id === imageId) ?? null;
}

function nearestFoodFor(fish) {
  if (!state.foods.length) return null;
  let nearest = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const food of state.foods) {
    const dx = food.x - fish.x;
    const dy = food.y - fish.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      nearest = food;
    }
  }
  return nearest;
}

function consumeFood(foodId) {
  const idx = state.foods.findIndex((f) => f.id === foodId);
  if (idx < 0) return false;
  state.foods.splice(idx, 1);
  return true;
}

function separationSteer(fish) {
  let sx = 0;
  let sy = 0;
  let neighbors = 0;
  for (const other of state.fishes) {
    if (other.id === fish.id) continue;
    const dx = fish.x - other.x;
    const dy = fish.y - other.y;
    const dist = Math.hypot(dx, dy);
    const minDist = (FISH_SIZE.w + FISH_SIZE.w) * 0.4;
    if (dist > 0 && dist < minDist) {
      const push = (minDist - dist) / minDist;
      sx += (dx / dist) * push;
      sy += (dy / dist) * push;
      neighbors += 1;
    }
  }
  if (!neighbors) return { x: 0, y: 0 };
  return { x: sx / neighbors, y: sy / neighbors };
}

function updateFish(fish, dt, now) {
  let target = fish.target;
  const nearbyFood = nearestFoodFor(fish);
  fish.targetFoodId = nearbyFood?.id || null;
  const sr = swimRect();
  if (nearbyFood) {
    target = nearbyFood;
  } else if (
    !target ||
    swimTargetIsInvalid(target) ||
    Math.hypot(target.x - fish.x, target.y - fish.y) < 22 ||
    now >= fish.retargetAt
  ) {
    fish.target = randomSwimTarget();
    fish.retargetAt = now + rand(1400, 4200);
    target = fish.target;
  }

  const dx = target.x - fish.x;
  const dy = target.y - fish.y;
  const len = Math.hypot(dx, dy) || 1;
  const cruisingSpeed = fish.baseSpeed;
  const speed = nearbyFood ? cruisingSpeed * 2.1 : cruisingSpeed;
  const desiredVx = (dx / len) * speed;
  const desiredVy = (dy / len) * speed;
  const spread = separationSteer(fish);
  const spreadStrength = nearbyFood ? speed * 0.2 : speed * 0.55;
  const finalDesiredVx = desiredVx + spread.x * spreadStrength;
  const finalDesiredVy = desiredVy + spread.y * spreadStrength;
  const steer = Math.min(1, dt * 2.7);

  fish.vx += (finalDesiredVx - fish.vx) * steer;
  fish.vy += (finalDesiredVy - fish.vy) * steer;

  fish.x += fish.vx * dt;
  fish.y += fish.vy * dt;

  fish.x = clamp(fish.x, sr.minX, sr.maxX);
  fish.y = clamp(fish.y, sr.minY, sr.maxY);

  if (fish.x <= sr.minX || fish.x >= sr.maxX) fish.vx *= -0.58;
  if (fish.y <= sr.minY || fish.y >= sr.maxY) fish.vy *= -0.58;

  const eatRadius = 24;
  if (nearbyFood && Math.hypot(nearbyFood.x - fish.x, nearbyFood.y - fish.y) < eatRadius) {
    if (consumeFood(nearbyFood.id) && state.fight.phase === "running") {
      state.fight.eatCounts[fish.id] = (state.fight.eatCounts[fish.id] || 0) + 1;
    }
  }
}

function updateFood(dt) {
  for (let i = state.foods.length - 1; i >= 0; i -= 1) {
    const food = state.foods[i];
    food.ttl -= dt * 1000;
    food.y += Math.min(14, 18 * dt);
    if (food.ttl <= 0 || food.y >= WORLD_HEIGHT - 40) {
      consumeFood(food.id);
    }
  }
}

function dropFood(x, y) {
  state.foods.push({
    id: id("food"),
    x,
    y,
    ttl: 12000
  });
}

function dropRandomFightFood() {
  if (WORLD_WIDTH < 48 || WORLD_HEIGHT < 48) return;
  const sr = swimRect();
  const foodX = sr.maxX > sr.minX ? rand(sr.minX, sr.maxX) : (sr.minX + sr.maxX) * 0.5;
  dropFood(foodX, rand(32, Math.max(32, WORLD_HEIGHT * 0.48)));
}

function spreadFishEvenlyForBattle(now) {
  const sr = swimRect();
  const n = state.fishes.length;
  if (n === 0) return;
  const swimW = sr.maxX - sr.minX;
  const usable = Math.max(0, swimW - FISH_SIZE.w);
  const yMid = sr.minY + Math.max(0, (sr.maxY - sr.minY - FISH_SIZE.h) * 0.38);
  state.fishes.forEach((fish, i) => {
    const x = n === 1 ? sr.minX + usable * 0.5 : sr.minX + (usable * i) / (n - 1);
    fish.x = clamp(x, sr.minX, sr.maxX);
    fish.y = clamp(yMid, sr.minY, sr.maxY);
    fish.vx = rand(-22, 22);
    fish.vy = rand(-16, 16);
    fish.target = randomSwimTarget();
    fish.retargetAt = now + rand(1400, 3600);
  });
}

function assignOrdinalPlaces(sorted) {
  const out = [];
  let rank = 1;
  let i = 0;
  while (i < sorted.length) {
    const c = sorted[i].count;
    let j = i + 1;
    while (j < sorted.length && sorted[j].count === c) j += 1;
    for (let k = i; k < j; k += 1) {
      out.push({ ...sorted[k], rank });
    }
    rank += j - i;
    i = j;
  }
  return out;
}

function incrementFishMedal(fishId, tier) {
  const cur = state.medals[fishId] || { gold: 0, silver: 0, bronze: 0 };
  cur[tier] = (cur[tier] || 0) + 1;
  state.medals[fishId] = cur;
}

function clearAllFood() {
  state.foods = [];
}

function endFightWithResults() {
  if (state.fight.phase !== "running") return;
  state.fight.phase = "results";
  clearAllFood();
  const sorted = state.fishes
    .map((fish) => ({ fish, count: state.fight.eatCounts[fish.id] || 0 }))
    .sort((a, b) => b.count - a.count || a.fish.id.localeCompare(b.fish.id));
  const ranked = assignOrdinalPlaces(sorted);
  for (const row of ranked) {
    if (row.rank === 1) incrementFishMedal(row.fish.id, "gold");
    else if (row.rank === 2) incrementFishMedal(row.fish.id, "silver");
    else if (row.rank === 3) incrementFishMedal(row.fish.id, "bronze");
  }
  state.fight.results = ranked.map((row) => ({
    fishId: row.fish.id,
    count: row.count,
    rank: row.rank
  }));
}

function startFight(durationSec, intervalSec) {
  if (!state.fishes.length) return;
  const duration = Number(durationSec);
  const interval = Number(intervalSec);
  if (!Number.isFinite(duration) || duration < 5 || duration > 900) return;
  if (!Number.isFinite(interval) || interval < 0.5 || interval > 120) return;
  if (interval > duration) return;
  const now = Date.now();
  state.fight.phase = "running";
  state.fight.endsAt = now + duration * 1000;
  state.fight.nextFoodAt = now;
  state.fight.foodIntervalMs = interval * 1000;
  state.fight.eatCounts = {};
  state.fight.results = [];
  state.fishes.forEach((f) => {
    state.fight.eatCounts[f.id] = 0;
  });
  spreadFishEvenlyForBattle(now);
}

function exitFightEarly() {
  if (state.fight.phase !== "running") return;
  state.fight.phase = "idle";
  state.fight.endsAt = 0;
  state.fight.nextFoodAt = 0;
  state.fight.results = [];
  clearAllFood();
}

function dismissResults() {
  if (state.fight.phase !== "results") return;
  state.fight.phase = "idle";
}

async function addFish(name, src) {
  if (typeof src !== "string" || !src.startsWith("data:image/")) return;
  const compressed = await images.compressDataUrl(src);
  if (!compressed) return;
  const img = { id: id("img"), src: compressed };
  state.images.push(img);
  const sr = swimRect();
  const sxLo = sr.minX;
  const sxHi = sr.maxX;
  const syLo = Math.min(sr.minY + 6, sr.maxY);
  const syHi = sr.maxY;
  const rawName = typeof name === "string" ? name.trim() : "";
  state.fishes.push({
    id: id("fish"),
    imageId: img.id,
    ...(rawName ? { name: rawName } : {}),
    x: sxHi > sxLo ? rand(sxLo, sxHi) : (sr.minX + sr.maxX) * 0.5,
    y: syHi > syLo ? rand(syLo, syHi) : (sr.minY + sr.maxY) * 0.5,
    vx: rand(-40, 40),
    vy: rand(-30, 30),
    baseSpeed: rand(44, 66),
    target: randomSwimTarget(),
    retargetAt: Date.now() + rand(1200, 3600),
    targetFoodId: null
  });
}

function removeFish(fishId) {
  const idx = state.fishes.findIndex((f) => f.id === fishId);
  if (idx < 0) return;
  const fish = state.fishes[idx];
  state.fishes.splice(idx, 1);
  const imageInUse = state.fishes.some((f) => f.imageId === fish.imageId);
  if (!imageInUse) {
    const iIdx = state.images.findIndex((img) => img.id === fish.imageId);
    if (iIdx >= 0) state.images.splice(iIdx, 1);
  }
  delete state.fight.eatCounts[fishId];
  if (!state.fishes.length && state.fight.phase === "running") exitFightEarly();
}

async function editFishImage(fishId, src) {
  if (typeof src !== "string" || !src.startsWith("data:image/")) return;
  const compressed = await images.compressDataUrl(src);
  if (!compressed) return;
  const fish = state.fishes.find((f) => f.id === fishId);
  if (!fish) return;
  const image = getImageById(fish.imageId);
  if (image) image.src = compressed;
}

async function compressStoredImages() {
  const changed = await images.compressImageRecords(state.images);
  if (changed) await store.save(persistencePayload());
  return changed;
}

function snapshot(includeImages = false) {
  const payload = {
    fishes: state.fishes.map((f) => ({
      id: f.id,
      imageId: f.imageId,
      name: fishDisplayName(f),
      x: f.x,
      y: f.y,
      vx: f.vx,
      vy: f.vy
    })),
    foods: state.foods.map((f) => ({
      id: f.id,
      x: f.x,
      y: f.y
    })),
    medals: state.medals,
    fight: {
      phase: state.fight.phase,
      endsAt: state.fight.endsAt,
      eatCounts: state.fight.eatCounts,
      results: state.fight.results
    }
  };
  if (includeImages) payload.images = state.images;
  return payload;
}

function broadcastState(includeImages = false) {
  let data = "";
  try {
    data = JSON.stringify({ type: "state", payload: snapshot(includeImages) });
  } catch (error) {
    console.error("Failed to serialize tank state:", error);
    return;
  }
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try {
        client.send(data);
      } catch (error) {
        console.error("Failed to send state to client:", error);
      }
    }
  }
}

function notifyTankChanged(includeImages = true) {
  broadcastState(includeImages);
  saveSnapshot();
}

function persistencePayload() {
  return {
    images: state.images,
    fishes: state.fishes,
    foods: state.foods,
    medals: state.medals
  };
}

function ensureFishRuntimeFields(fish) {
  const now = Date.now();
  const sr = swimRect();
  if (typeof fish.x !== "number") fish.x = rand(sr.minX, sr.maxX);
  if (typeof fish.y !== "number") fish.y = rand(sr.minY, sr.maxY);
  if (typeof fish.vx !== "number") fish.vx = rand(-40, 40);
  if (typeof fish.vy !== "number") fish.vy = rand(-30, 30);
  if (typeof fish.baseSpeed !== "number") fish.baseSpeed = rand(44, 66);
  if (!fish.target || swimTargetIsInvalid(fish.target)) fish.target = randomSwimTarget();
  if (typeof fish.retargetAt !== "number") fish.retargetAt = now + rand(1200, 3600);
  if (fish.targetFoodId === undefined) fish.targetFoodId = null;
}

function applyPersistedPayload(parsed) {
  const payload = store.normalizePayload(parsed);
  if (!payload) return false;
  state.images = payload.images;
  state.fishes = payload.fishes;
  state.foods = payload.foods;
  state.medals = payload.medals;
  state.fight = {
    phase: "idle",
    endsAt: 0,
    nextFoodAt: 0,
    foodIntervalMs: 2000,
    eatCounts: {},
    results: []
  };
  for (const fish of state.fishes) ensureFishRuntimeFields(fish);
  return true;
}

function saveSnapshot() {
  store.save(persistencePayload()).catch((error) => {
    console.error("Failed to save snapshot:", error);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function adminAuthorized(req) {
  if (!ADMIN_SECRET) return false;
  const key = req.headers["x-admin-key"];
  return typeof key === "string" && key === ADMIN_SECRET;
}

async function handleAdminApi(req, res, url) {
  if (!url.pathname.startsWith("/api/admin/")) return false;

  if (!adminAuthorized(req)) {
    res.writeHead(ADMIN_SECRET ? 401 : 503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(ADMIN_SECRET ? "Unauthorized" : "Admin API disabled (set ADMIN_SECRET)");
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/export") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(persistencePayload()));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/import") {
    let raw = "";
    try {
      raw = await readRequestBody(req);
      const parsed = JSON.parse(raw);
      if (!applyPersistedPayload(parsed)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid tank state JSON");
        return true;
      }
      await store.save(persistencePayload());
      broadcastState(true);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Imported ${state.fishes.length} fish.`);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid request body");
    }
    return true;
  }

  res.writeHead(404);
  res.end("Not found");
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (await handleAdminApi(req, res, url)) return;

  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "state", payload: snapshot(true) }));
  ws.on("message", async (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const payload = msg.payload || {};
    let imagesChanged = false;
    try {
      if (msg.type === "addFish") {
        await addFish(payload.name, payload.src);
        imagesChanged = true;
      } else if (msg.type === "removeFish") {
        removeFish(payload.fishId);
        imagesChanged = true;
      } else if (msg.type === "editFishImage") {
        await editFishImage(payload.fishId, payload.src);
        imagesChanged = true;
      } else if (msg.type === "startFight") startFight(payload.durationSec, payload.foodIntervalSec);
      else if (msg.type === "exitFightEarly") exitFightEarly();
      else if (msg.type === "dismissResults") dismissResults();
    } catch (error) {
      console.error("WebSocket message handler error:", error);
      return;
    }
    if (imagesChanged) notifyTankChanged(true);
  });
});

function startGameLoops() {
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;

    updateFood(dt);
    for (const fish of state.fishes) updateFish(fish, dt, now);

    if (state.fight.phase === "running") {
      if (now >= state.fight.endsAt) {
        endFightWithResults();
      } else {
        let drops = 0;
        while (now >= state.fight.nextFoodAt && state.fight.nextFoodAt < state.fight.endsAt && drops < 5) {
          dropRandomFightFood();
          state.fight.nextFoodAt += state.fight.foodIntervalMs;
          drops += 1;
        }
      }
    }
    broadcastState(false);
  }, 50);

  setInterval(saveSnapshot, 10_000);
}

async function start() {
  await store.init();
  let saved = await store.load();
  if (store.isEmptyPayload(saved)) {
    const seed = store.loadSeedFile();
    if (seed) {
      applyPersistedPayload(seed);
      await compressStoredImages();
      console.log("Loaded initial tank from seed-state.json");
    }
  } else {
    applyPersistedPayload(saved);
    console.log(`Restored tank (${state.fishes.length} fish) from ${store.storageLabel()}`);
    if (process.env.DATABASE_URL) {
      await store.save(persistencePayload());
      console.log("Persisted compressed fish images to database");
    } else {
      await compressStoredImages();
    }
  }

  server.listen(PORT, () => {
    console.log(`Fish tank server running on http://localhost:${PORT}`);
    console.log(`Persistence: ${store.storageLabel()}`);
    startGameLoops();
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
