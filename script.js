const FOOD_ICON = "🟤";
const fishSize = { w: 72, h: 44 };
const UNIFORM_FISH_SCALE = 0.82;

const tank = document.getElementById("tank");
const addFishBtn = document.getElementById("addFishBtn");
const fishImageEditInput = document.getElementById("fishImageEditInput");
const addFishModal = document.getElementById("addFishModal");
const addFishNameInput = document.getElementById("addFishNameInput");
const addFishImageInput = document.getElementById("addFishImageInput");
const addFishImageLabel = document.getElementById("addFishImageLabel");
const addFishSourceDefault = document.getElementById("addFishSourceDefault");
const addFishSourceUpload = document.getElementById("addFishSourceUpload");
const addFishDefaultPanel = document.getElementById("addFishDefaultPanel");
const addFishUploadPanel = document.getElementById("addFishUploadPanel");
const addFishColorInput = document.getElementById("addFishColorInput");
const addFishPreview = document.getElementById("addFishPreview");
const addFishModalCancelBtn = document.getElementById("addFishModalCancelBtn");
const addFishModalConfirmBtn = document.getElementById("addFishModalConfirmBtn");

const DEFAULT_FISH_COLOR = "#f28b54";
let addFishPreviewRequest = 0;
const sidePanel = document.getElementById("sidePanel");
const mainPanelContent = document.getElementById("mainPanelContent");
const battleExitPanel = document.getElementById("battleExitPanel");
const exitBattleBtn = document.getElementById("exitBattleBtn");
const startBattleBtn = document.getElementById("startBattleBtn");
const leaderboardInline = document.getElementById("leaderboardInline");
const battleSetupModal = document.getElementById("battleSetupModal");
const battleDurationInput = document.getElementById("battleDurationInput");
const battleFoodIntervalInput = document.getElementById("battleFoodIntervalInput");
const battleStartConfirmBtn = document.getElementById("battleStartConfirmBtn");
const battleSetupCancelBtn = document.getElementById("battleSetupCancelBtn");
const battleResultsOverlay = document.getElementById("battleResultsOverlay");
const battleResultsPodium = document.getElementById("battleResultsPodium");
const backToMainTankBtn = document.getElementById("backToMainTankBtn");
const battleScoreboardList = document.getElementById("battleScoreboardList");
const battleCountdown = document.getElementById("battleCountdown");
const panelTitle = document.getElementById("panelTitle");

const fishEls = new Map();
const foodEls = new Map();
let countdownTimerId = null;

const state = {
  images: [],
  fishes: [],
  foods: [],
  medals: {},
  fight: {
    phase: "idle",
    endsAt: 0,
    eatCounts: {},
    results: []
  },
  selectedFishId: null,
  connected: false
};

let socket = null;

function fishDimensions() {
  return {
    w: fishSize.w * UNIFORM_FISH_SCALE,
    h: fishSize.h * UNIFORM_FISH_SCALE
  };
}

function tankBounds() {
  return {
    w: tank.clientWidth,
    h: tank.clientHeight
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fishDisplayName(fish) {
  const n = fish?.name;
  if (typeof n === "string" && n.trim()) return n.trim();
  return `Fish ${String(fish?.id || "").slice(-6)}`;
}

function getImageById(imageId) {
  return state.images.find((img) => img.id === imageId) ?? null;
}

function getFishMedals(fishId) {
  const m = state.medals?.[fishId];
  return {
    gold: m?.gold || 0,
    silver: m?.silver || 0,
    bronze: m?.bronze || 0
  };
}

function wsSend(type, payload = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    window.alert("Lost connection to the tank. Wait a few seconds and try again.");
    return false;
  }
  socket.send(JSON.stringify({ type, payload }));
  return true;
}

function worldToTank(x, y) {
  const b = tankBounds();
  return {
    x: (x / 1000) * b.w,
    y: (y / 600) * b.h
  };
}

function renderFish() {
  const currentIds = new Set(state.fishes.map((fish) => fish.id));
  for (const [fishId, el] of fishEls.entries()) {
    if (!currentIds.has(fishId)) {
      el.remove();
      fishEls.delete(fishId);
      if (state.selectedFishId === fishId) state.selectedFishId = null;
    }
  }

  const dims = fishDimensions();
  for (const fish of state.fishes) {
    let el = fishEls.get(fish.id);
    if (!el) {
      el = document.createElement("img");
      el.className = "fish";
      el.draggable = false;
      el.dataset.fishId = fish.id;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.fight.phase === "running") return;
        state.selectedFishId = fish.id;
        refreshSelectionUI();
      });
      tank.appendChild(el);
      fishEls.set(fish.id, el);
    }
    const imgMeta = getImageById(fish.imageId);
    el.src = imgMeta?.src ?? "";
    el.alt = fishDisplayName(fish);
    el.style.width = `${dims.w}px`;
    el.style.height = `${dims.h}px`;
    const p = worldToTank(fish.x, fish.y);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.transform = fish.vx >= 0 ? "scaleX(1)" : "scaleX(-1)";
    el.classList.toggle("selected", fish.id === state.selectedFishId);
  }
}

function renderFood() {
  const currentIds = new Set(state.foods.map((food) => food.id));
  for (const [foodId, el] of foodEls.entries()) {
    if (!currentIds.has(foodId)) {
      el.remove();
      foodEls.delete(foodId);
    }
  }
  for (const food of state.foods) {
    let el = foodEls.get(food.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "food";
      el.textContent = FOOD_ICON;
      tank.appendChild(el);
      foodEls.set(food.id, el);
    }
    const p = worldToTank(food.x, food.y);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  }
}

function renderInlineLeaderboard() {
  if (!leaderboardInline) return;
  if (!state.fishes.length) {
    leaderboardInline.innerHTML =
      '<p class="hint" style="margin:0">No fish yet. Use Add fish to create one — medals appear here after battles.</p>';
    return;
  }
  const head = `<div class="leaderboard-row lb-head"><span></span><span>Fish</span><span class="lb-medal">Gold</span><span class="lb-medal">Silver</span><span class="lb-medal">Bronze</span></div>`;
  const rows = state.fishes
    .map((fish) => {
      const m = getFishMedals(fish.id);
      const meta = getImageById(fish.imageId);
      const src = meta?.src ?? "";
      const label = escapeHtml(fishDisplayName(fish));
      return `<div class="leaderboard-row"><img src="${src}" alt="" /><span>${label}</span><span class="lb-medal">${m.gold}</span><span class="lb-medal">${m.silver}</span><span class="lb-medal">${m.bronze}</span></div>`;
    })
    .join("");
  leaderboardInline.innerHTML = head + rows;
}

function renderBattleScoreboard() {
  if (!battleScoreboardList) return;
  if (state.fight.phase !== "running") {
    battleScoreboardList.innerHTML = "";
    return;
  }
  const rows = state.fishes
    .map((fish) => ({
      fish,
      count: state.fight.eatCounts[fish.id] || 0
    }))
    .sort((a, b) => b.count - a.count || a.fish.id.localeCompare(b.fish.id))
    .map((row) => {
      const meta = getImageById(row.fish.imageId);
      return `<div class="battle-score-row"><img src="${meta?.src ?? ""}" alt="" /><span class="battle-score-count">${row.count}</span></div>`;
    })
    .join("");
  battleScoreboardList.innerHTML = rows;
}

function renderBattleResultsPodium() {
  const ranked = Array.isArray(state.fight.results) ? state.fight.results : [];
  const labels = { 1: "1st place", 2: "2nd place", 3: "3rd place" };
  const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
  const podiumRows = ranked
    .filter((row) => row.rank <= 3)
    .sort((a, b) => a.rank - b.rank || a.fishId.localeCompare(b.fishId));
  battleResultsPodium.innerHTML = podiumRows
    .map((row) => {
      const fish = state.fishes.find((f) => f.id === row.fishId);
      const meta = fish ? getImageById(fish.imageId) : null;
      const fname = fish ? escapeHtml(fishDisplayName(fish)) : "Fish";
      const rk = row.rank;
      const label = labels[rk] ?? `${rk}th place`;
      const medal = medals[rk] ?? "🏅";
      return `
    <article class="podium-slot rank-${rk}">
      <div class="podium-rank-row"><span>${medal}</span><span>${label}</span></div>
      <img class="podium-fish-img" src="${meta?.src ?? ""}" alt="${fname}" />
      <div class="podium-fish-name">${fname}</div>
      <div class="podium-eats">${row.count} piece${row.count === 1 ? "" : "s"} eaten</div>
    </article>`;
    })
    .join("");
  if (!podiumRows.length) {
    battleResultsPodium.innerHTML = '<p class="modal-hint">No fish were in the tank.</p>';
  }
}

function formatCountdown(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateBattleCountdown() {
  if (!battleCountdown) return;
  if (state.fight.phase !== "running" || !state.fight.endsAt) {
    battleCountdown.hidden = true;
    return;
  }
  const remaining = state.fight.endsAt - Date.now();
  battleCountdown.hidden = false;
  battleCountdown.textContent = formatCountdown(remaining);
  battleCountdown.classList.toggle("battle-countdown-urgent", remaining <= 10_000);
}

function startCountdownTimer() {
  stopCountdownTimer();
  updateBattleCountdown();
  countdownTimerId = window.setInterval(updateBattleCountdown, 250);
}

function stopCountdownTimer() {
  if (countdownTimerId) {
    window.clearInterval(countdownTimerId);
    countdownTimerId = null;
  }
  if (battleCountdown) battleCountdown.hidden = true;
}

function syncFightPanel() {
  const running = state.fight.phase === "running";
  if (sidePanel) sidePanel.hidden = false;
  if (mainPanelContent) mainPanelContent.hidden = running;
  if (battleExitPanel) battleExitPanel.hidden = !running;
  if (panelTitle) panelTitle.textContent = running ? "Fish Tank — Battle" : "Fish Tank";
  battleResultsOverlay.hidden = state.fight.phase !== "results";
  document.body.classList.toggle("battle-active", running);
  if (running) startCountdownTimer();
  else stopCountdownTimer();
}

function refreshControls() {
  if (addFishBtn) addFishBtn.disabled = !state.connected || state.fight.phase === "running";
  if (startBattleBtn) {
    startBattleBtn.disabled = !state.connected || !state.fishes.length || state.fight.phase === "running";
  }
}

function refreshSelectionUI() {
  if (state.fight.phase === "running") state.selectedFishId = null;
  for (const [fishId, el] of fishEls.entries()) {
    el.classList.toggle("selected", fishId === state.selectedFishId);
  }
  syncFishActionBar();
  refreshControls();
}

function syncFishActionBar() {
  const bar = document.getElementById("fishActionBar");
  if (!bar) return;
  if (state.fight.phase === "running" || !state.selectedFishId) {
    bar.hidden = true;
    return;
  }
  const fish = state.fishes.find((f) => f.id === state.selectedFishId);
  const el = fish ? fishEls.get(fish.id) : null;
  if (!fish || !el) {
    bar.hidden = true;
    return;
  }
  const dims = fishDimensions();
  const p = worldToTank(fish.x, fish.y);
  const barSlot = 42;
  const gap = 6;
  let top = p.y - barSlot - gap;
  if (top < 6) top = p.y + dims.h + gap;
  const cx = p.x + dims.w / 2;
  bar.hidden = false;
  bar.style.left = `${cx}px`;
  bar.style.top = `${top}px`;
}

function applyRemoteState(payload) {
  if (Array.isArray(payload.images)) state.images = payload.images;
  state.fishes = Array.isArray(payload.fishes) ? payload.fishes : [];
  state.foods = Array.isArray(payload.foods) ? payload.foods : [];
  state.medals = payload.medals && typeof payload.medals === "object" ? payload.medals : {};
  const fight = payload.fight || {};
  state.fight = {
    phase: fight.phase || "idle",
    endsAt: Number(fight.endsAt) || 0,
    eatCounts: fight.eatCounts || {},
    results: Array.isArray(fight.results) ? fight.results : []
  };
  if (state.selectedFishId && !state.fishes.some((f) => f.id === state.selectedFishId)) {
    state.selectedFishId = null;
  }
  renderFish();
  renderFood();
  renderInlineLeaderboard();
  renderBattleScoreboard();
  updateBattleCountdown();
  renderBattleResultsPodium();
  syncFightPanel();
  refreshSelectionUI();
}

function canvasHasTransparency(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor((w * h) / 4096) * 4);
  for (let i = 3; i < data.length; i += step) {
    if (data[i] < 250) return true;
  }
  return false;
}

function rasterizeToDataUrl(img, maxDim = 320) {
  const longest = Math.max(img.width, img.height, 1);
  const scale = Math.min(1, maxDim / longest);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const hasAlpha = canvasHasTransparency(ctx, w, h);
  return hasAlpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.82);
}

function uploadAsDataUrl(file, maxDim = 320) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const dataUrl = rasterizeToDataUrl(img, maxDim);
        if (dataUrl) resolve(dataUrl);
        else resolve(String(reader.result));
      };
      img.onerror = () => reject(new Error("Image decode failed"));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function defaultFishSvg(color) {
  const fill = color || DEFAULT_FISH_COLOR;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 72">
    <ellipse cx="46" cy="36" rx="38" ry="24" fill="${fill}"/>
    <path d="M84 36 L116 20 L116 52 Z" fill="${fill}"/>
    <circle cx="30" cy="28" r="6" fill="#ffffff"/>
    <circle cx="29" cy="28" r="3" fill="#173040"/>
  </svg>`;
}

function generateDefaultFishDataUrl(color) {
  const svg = defaultFishSvg(color);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const dataUrl = rasterizeToDataUrl(img, 200);
      if (dataUrl) resolve(dataUrl);
      else reject(new Error("Could not render default fish"));
    };
    img.onerror = () => reject(new Error("Could not render default fish"));
    img.src = url;
  });
}

function addFishUsesDefault() {
  return Boolean(addFishSourceDefault?.checked);
}

function syncAddFishSourcePanels() {
  const useDefault = addFishUsesDefault();
  if (addFishDefaultPanel) addFishDefaultPanel.hidden = !useDefault;
  if (addFishUploadPanel) addFishUploadPanel.hidden = useDefault;
}

async function refreshAddFishPreview() {
  if (!addFishPreview) return;
  const requestId = ++addFishPreviewRequest;
  try {
    let src = "";
    if (addFishUsesDefault()) {
      const color = addFishColorInput?.value || DEFAULT_FISH_COLOR;
      src = await generateDefaultFishDataUrl(color);
    } else {
      const file = addFishImageInput?.files?.[0];
      if (file) src = await uploadAsDataUrl(file);
    }
    if (requestId !== addFishPreviewRequest) return;
    if (src) {
      addFishPreview.src = src;
      addFishPreview.hidden = false;
    } else {
      addFishPreview.removeAttribute("src");
      addFishPreview.hidden = true;
    }
  } catch {
    if (requestId === addFishPreviewRequest) {
      addFishPreview.removeAttribute("src");
      addFishPreview.hidden = true;
    }
  }
}

function resetAddFishModal() {
  if (addFishNameInput) addFishNameInput.value = "";
  if (addFishImageInput) addFishImageInput.value = "";
  if (addFishSourceDefault) addFishSourceDefault.checked = true;
  if (addFishSourceUpload) addFishSourceUpload.checked = false;
  if (addFishColorInput) addFishColorInput.value = DEFAULT_FISH_COLOR;
  if (addFishImageLabel) {
    addFishImageLabel.textContent = "No file chosen";
    addFishImageLabel.dataset.empty = "true";
  }
  syncAddFishSourcePanels();
  refreshAddFishPreview();
}

function closeAddFishModal() {
  if (!addFishModal) return;
  addFishModal.hidden = true;
  resetAddFishModal();
}

function openAddFishModal() {
  if (state.fight.phase === "running" || !addFishModal || !state.connected) return;
  resetAddFishModal();
  addFishModal.hidden = false;
  addFishNameInput?.focus();
}

function closeBattleSetupModal() {
  battleSetupModal.hidden = true;
}

function openBattleSetupModal() {
  if (!state.connected) return;
  if (!state.fishes.length) {
    window.alert("Add at least one fish to the tank before starting a battle.");
    return;
  }
  battleSetupModal.hidden = false;
}

function initFishActionBar() {
  if (document.getElementById("fishActionBar")) return;
  const bar = document.createElement("div");
  bar.id = "fishActionBar";
  bar.className = "fish-action-bar";
  bar.setAttribute("hidden", "");
  bar.innerHTML =
    '<button type="button" class="fish-action-btn fish-action-edit" aria-label="Edit fish image">✏️</button>' +
    '<button type="button" class="fish-action-btn fish-action-remove" aria-label="Remove fish">🗑️</button>';
  bar.addEventListener("click", (e) => e.stopPropagation());
  bar.querySelector(".fish-action-edit").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!state.selectedFishId || !fishImageEditInput) return;
    fishImageEditInput.click();
  });
  bar.querySelector(".fish-action-remove").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!state.selectedFishId) return;
    wsSend("removeFish", { fishId: state.selectedFishId });
    state.selectedFishId = null;
    refreshSelectionUI();
  });
  tank.appendChild(bar);
}

function connectSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${protocol}://${window.location.host}`;
  socket = new WebSocket(wsUrl);
  socket.addEventListener("open", () => {
    state.connected = true;
    refreshControls();
  });
  socket.addEventListener("close", () => {
    state.connected = false;
    refreshControls();
    setTimeout(connectSocket, 1000);
  });
  socket.addEventListener("error", () => {
    state.connected = false;
    refreshControls();
  });
  socket.addEventListener("message", (event) => {
    let msg = null;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "state") {
      applyRemoteState(msg.payload || {});
    }
  });
}

if (fishImageEditInput) {
  fishImageEditInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !state.selectedFishId) return;
    try {
      const src = await uploadAsDataUrl(file);
      wsSend("editFishImage", { fishId: state.selectedFishId, src });
    } catch {
      window.alert("Could not load that image file.");
    } finally {
      fishImageEditInput.value = "";
    }
  });
}

addFishSourceDefault?.addEventListener("change", () => {
  syncAddFishSourcePanels();
  refreshAddFishPreview();
});
addFishSourceUpload?.addEventListener("change", () => {
  syncAddFishSourcePanels();
  refreshAddFishPreview();
});
addFishColorInput?.addEventListener("input", () => {
  if (addFishUsesDefault()) refreshAddFishPreview();
});

if (addFishImageInput && addFishImageLabel) {
  addFishImageInput.addEventListener("change", () => {
    const f = addFishImageInput.files?.[0];
    if (!f) {
      addFishImageLabel.textContent = "No file chosen";
      addFishImageLabel.dataset.empty = "true";
      refreshAddFishPreview();
      return;
    }
    addFishImageLabel.textContent = f.name;
    addFishImageLabel.dataset.empty = "false";
    refreshAddFishPreview();
  });
}

addFishModalCancelBtn?.addEventListener("click", closeAddFishModal);
addFishModal?.addEventListener("click", (e) => {
  if (e.target === addFishModal) closeAddFishModal();
});

addFishModalConfirmBtn?.addEventListener("click", async () => {
  const name = addFishNameInput?.value.trim() ?? "";
  if (!name) {
    window.alert("Please enter a name for your fish.");
    return;
  }
  try {
    let src = "";
    if (addFishUsesDefault()) {
      src = await generateDefaultFishDataUrl(addFishColorInput?.value || DEFAULT_FISH_COLOR);
    } else {
      const file = addFishImageInput?.files?.[0];
      if (!file) {
        window.alert("Please choose an image, or use the default fish.");
        return;
      }
      src = await uploadAsDataUrl(file);
    }
    if (!wsSend("addFish", { name, src })) return;
    closeAddFishModal();
  } catch {
    window.alert("Could not prepare that fish image.");
  }
});

addFishBtn.addEventListener("click", openAddFishModal);
startBattleBtn.addEventListener("click", openBattleSetupModal);
battleSetupCancelBtn.addEventListener("click", closeBattleSetupModal);
battleSetupModal.addEventListener("click", (e) => {
  if (e.target === battleSetupModal) closeBattleSetupModal();
});
battleStartConfirmBtn.addEventListener("click", () => {
  const duration = Number(battleDurationInput.value);
  const interval = Number(battleFoodIntervalInput.value);
  if (!Number.isFinite(duration) || duration < 5 || duration > 900) {
    window.alert("Battle time must be between 5 and 900 seconds.");
    return;
  }
  if (!Number.isFinite(interval) || interval < 0.5 || interval > 120) {
    window.alert("Food interval must be between 0.5 and 120 seconds.");
    return;
  }
  if (interval > duration) {
    window.alert("Food interval must be less than or equal to battle time.");
    return;
  }
  state.selectedFishId = null;
  closeBattleSetupModal();
  wsSend("startFight", { durationSec: duration, foodIntervalSec: interval });
});
exitBattleBtn?.addEventListener("click", () => {
  if (state.fight.phase !== "running") return;
  const ok = window.confirm("Exit battle now? No medals will be awarded for this fight.");
  if (!ok) return;
  wsSend("exitFightEarly");
});
backToMainTankBtn.addEventListener("click", () => {
  wsSend("dismissResults");
});
tank.addEventListener("click", () => {
  if (state.fight.phase === "running") return;
  state.selectedFishId = null;
  refreshSelectionUI();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (addFishModal && !addFishModal.hidden) {
    closeAddFishModal();
    return;
  }
  if (!battleSetupModal.hidden) closeBattleSetupModal();
  if (state.fight.phase === "running") {
    const ok = window.confirm("Exit battle now? No medals will be awarded for this fight.");
    if (ok) wsSend("exitFightEarly");
  }
});

window.addEventListener("resize", () => {
  renderFish();
  renderFood();
  syncFishActionBar();
});

initFishActionBar();
refreshControls();
connectSocket();
