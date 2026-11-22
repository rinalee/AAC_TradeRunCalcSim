const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vThZSxVuXYBFDKYryw2Jc3oUtAu-qj0U_5qlMWWlN8rYIw2XBmuVMF-FMP-Nxwjb1k2T2Y4_QQVO3w-/pub?output=csv";

// Optional: set a dedicated published CSV URL for Lookup if published separately, or leave "" to check combined/embedded Lookup
const LOOKUP_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vThZSxVuXYBFDKYryw2Jc3oUtAu-qj0U_5qlMWWlN8rYIw2XBmuVMF-FMP-Nxwjb1k2T2Y4_QQVO3w-/pub?gid=2129492780&single=true&output=csv";

const EMBEDDED_MAIN_ROWS = [];
const EMBEDDED_LOOKUP_ROWS = [];


function normalizeGoodKey(name) {
  return name
    .toLowerCase()
    .replace(/trade box$/i, "trade goods")
    .replace(/\s+/g, " ")
    .trim();
}

const REGION_TO_OUTPOST = {
  "seaglass harbor": "Seaglass Harbor Trading Post",
  "watcher's trading post": "Watcher's Trading Post",
  "Watcher's": "Watcher's Trading Post",
  "jubilant village": "Jubilant Village Trading Post",
  "waterdrift trading post": "Waterdrift Trading Post",
  "stargazer village": "Stargazer Trading Post",
  "shadowpath trading post": "Shadowpath Temple Trading Post"
};

function resolveOutpostFromRegion(regionName) {
  if (!regionName) return "—";
  const key = regionName.toLowerCase().trim();
  return REGION_TO_OUTPOST[key] || regionName;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
      } else if (ch === CR && next === LF) {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = "";
        i++;
      } else if (ch === LF || ch === CR) {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function parseGoldNumber(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/,/g, "").trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*G?$/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return Number.isFinite(val) ? Math.round(val) : null;
}

function parseReward(raw) {
  const goldMatch = raw.match(/^(\d[\d,]*)\s*~\s*(\d[\d,]*)\s*G$/i);
  if (goldMatch) {
    const min = parseInt(goldMatch[1].replace(/,/g, ""), 10);
    const max = parseInt(goldMatch[2].replace(/,/g, ""), 10);
    return {
      type: "gold",
      raw,
      min,
      max,
      avg: Math.round((min + max) / 2)
    };
  }
  return {
    type: "item",
    raw,
    min: null,
    max: null,
    avg: null
  };
}

function parseTradingPostSheet(rows) {
  const outposts = [];
  let current = null;

  for (const r of rows) {
    const c0 = (r[0] || "").trim();
    const c1 = (r[1] || "").trim();
    const c2 = (r[2] || "").trim();
    const c3 = (r[3] || "").trim(); // Quantity (100%) for item rewards
    const c4 = (r[4] || "").trim(); // Dispatch Trade Goods

    if (!c0 && !c1 && !c2 && !c4) continue;
    if (c0 === "Trading Post Info") continue;

    if (c0 && !c1 && !c2) {
      current = {
        name: c0,
        sales: [],
        dispatch: []
      };
      outposts.push(current);
      continue;
    }

    if (c0 === "Trade Goods for Sale") continue;

    if (current) {
      if (c0 && c2) {
        const reward = parseReward(c2);
        // Col D = Quantity (100%) — mainly for item/material rewards
        if (c3) {
          const q = parseInt(c3.replace(/,/g, ""), 10);
          if (Number.isFinite(q) && q > 0) {
            reward.qty = q;
          }
        }
        current.sales.push({
          good: c0,
          key: normalizeGoodKey(c0),
          region: c1,
          reward
        });
      }
      if (c4) {
        current.dispatch.push({
          good: c4,
          key: normalizeGoodKey(c4)
        });
      }
    }
  }

  return outposts;
}

function getItemQtyRange(reward) {
  if (!reward || reward.type !== "item") return null;
  const baseQty = (reward.qty != null && reward.qty > 0) ? reward.qty : null;
  if (baseQty === null) return null;
  const maxQty = Math.round(baseQty * 1.4);
  return { min: baseQty, max: maxQty };
}

function formatRewardLabel(reward) {
  if (!reward) return "—";
  if (reward.type === "gold") return reward.raw;
  const range = getItemQtyRange(reward);
  if (range) {
    const qtyLabel = range.max > range.min ? (range.min + "~" + range.max) : String(range.min);
    return "×" + qtyLabel + " " + reward.raw;
  }
  return reward.raw;
}

// Parses Lookup rows where:
// Col A (0): Pack / Trade Good name
// Col B (1): Trademark Region (optional)
// Col C (2): Buy Price in Gold (e.g. "1200G" or "1,200")
// Cols D, E, F (3, 4, 5): Materials (optional; if empty, no materials are consumed)
function parseLookupTable(rows) {
  const lookupMap = new Map();

  for (const r of rows) {
    const name = (r[0] || "").trim();
    if (!name || name.toLowerCase() === "trade goods for sale" || name.toLowerCase() === "pack" || name.toLowerCase() === "item name") {
      continue;
    }

    const region = (r[1] || "").trim();
    // Lookup schema:
    // C Cost | D Packing Cost | E Material 1 | F Quantity | G Arcane Sealed Chest (0/1) | H Blank Trade Certificate (0/1)
    const costGold = parseGoldNumber(r[2] || "");
    const packingCostGold = parseGoldNumber(r[3] || "");

    const hasCostCol = (r[2] || "").trim() !== "";
    const hasPackingCol = (r[3] || "").trim() !== "";
    if (!hasCostCol && !hasPackingCol) continue;
    // Skip main-sheet contamination (reward ranges in col C)
    if (costGold === null && packingCostGold === null && hasCostCol) continue;

    const matName = (r[4] || "").trim();
    const matQtyRaw = (r[5] || "").trim();
    const matQty = matQtyRaw ? (parseInt(matQtyRaw, 10) || null) : null;
    const needsArcane = String(r[6] || "").trim() === "1";
    const needsBlankCert = String(r[7] || "").trim() === "1";

    let buyPriceGold = null;
    let costSource = null;
    if (costGold !== null && costGold > 0) {
      buyPriceGold = costGold;
      costSource = "cost";
    } else if (packingCostGold !== null && packingCostGold > 0) {
      buyPriceGold = packingCostGold;
      costSource = "packing";
    } else if (costGold === 0 && packingCostGold === 0) {
      buyPriceGold = 0;
      costSource = "cost";
    }

    const materials = [];
    if (matName) {
      materials.push({ name: matName, qty: matQty });
    }
    if (needsArcane) {
      materials.push({ name: "Arcane Sealed Chest", qty: 1 });
    }
    if (needsBlankCert) {
      materials.push({ name: "Blank Trade Certificate", qty: 1 });
    }

    const entry = {
      name,
      key: normalizeGoodKey(name),
      region,
      costGold,
      packingCostGold,
      buyPriceGold,
      costSource,
      materials
    };

    lookupMap.set(name.toLowerCase(), entry);
    if (!lookupMap.has(entry.key)) {
      lookupMap.set(entry.key, entry);
    }
  }

  return lookupMap;
}

function getLookupEntry(goodObj, lookupMap) {
  if (!goodObj || !lookupMap) return null;
  return lookupMap.get(goodObj.name.toLowerCase()) || lookupMap.get(goodObj.key) || null;
}

let state = {
  outposts: [],
  dispatchByGoodKey: {},
  allGoods: [],
  lookupMap: new Map(),
  selectedOrigin: "ALL",
  selectedDest: "",
  selectedGood: "",
  activeTab: "sale",
  rewardFilter: "all",
  searchQuery: "",
  runSlots: [] // up to 7 pack names for trade run simulation
};

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const footerSource = document.getElementById("footerSource");
const originSelect = document.getElementById("originSelect");
const goodSelect = document.getElementById("goodSelect");
const destSelect = document.getElementById("destSelect");
const leftList = document.getElementById("leftList");
const searchInput = document.getElementById("searchInput");
const saleControls = document.getElementById("saleControls");

function applyData(outposts, lookupMap, modeLabel, dotClass) {
  const dispatchByGoodKey = {};
  const goodsMap = new Map();

  for (const op of outposts) {
    for (const d of op.dispatch) {
      dispatchByGoodKey[d.key] = op.name;
    }
    for (const s of op.sales) {
      if (!goodsMap.has(s.good)) {
        const lkp = lookupMap.get(s.good.toLowerCase()) || lookupMap.get(s.key);
        goodsMap.set(s.good, {
          name: s.good,
          key: s.key,
          region: s.region || (lkp ? lkp.region : ""),
          originOutpost: dispatchByGoodKey[s.key] || resolveOutpostFromRegion(s.region || (lkp ? lkp.region : ""))
        });
      }
    }
  }

  for (const item of goodsMap.values()) {
    if (dispatchByGoodKey[item.key]) {
      item.originOutpost = dispatchByGoodKey[item.key];
    }
  }

  state.outposts = outposts;
  state.dispatchByGoodKey = dispatchByGoodKey;
  state.allGoods = Array.from(goodsMap.values());
  state.lookupMap = lookupMap;

  if (!state.selectedDest || !outposts.some(o => o.name === state.selectedDest)) {
    state.selectedDest = outposts[0].name;
  }

  populateDropdowns();
  renderAll();

  const pricedCount = Array.from(new Set(
    Array.from(lookupMap.values()).filter(v => v.buyPriceGold !== null).map(v => v.key)
  )).length;

  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  statusDot.className = "status-dot " + dotClass;
  statusText.textContent = modeLabel + " (" + outposts.length + " Outposts · " + state.allGoods.length + " Packs · " + pricedCount + " Buy Prices) · " + now;
  footerSource.textContent = modeLabel;
}

async function fetchWithTimeout(url, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadSheetData() {
  statusDot.className = "status-dot";
  statusText.textContent = "Syncing Google Sheet...";

  let outposts = [];
  let lookupMap = parseLookupTable(EMBEDDED_LOOKUP_ROWS);
  let isLiveMain = false;

  try {
    const csvText = await fetchWithTimeout(SHEET_CSV_URL + "&_t=" + Date.now());
    const rows = parseCSV(csvText);
    outposts = parseTradingPostSheet(rows);

    // Merge only valid Lookup rows (gold cost in Col C).
    const parsedLookup = parseLookupTable(rows);
    for (const [k, v] of parsedLookup) {
      lookupMap.set(k, v);
    }

    if (outposts.length > 0) {
      isLiveMain = true;
    }
  } catch (err) {
    console.warn("Direct CSV fetch failed:", err);
  }

  if (!isLiveMain) {
    try {
      const proxyText = await fetchWithTimeout("sheet.php?_t=" + Date.now());
      const rows = parseCSV(proxyText);
      outposts = parseTradingPostSheet(rows);
      const parsedLookup = parseLookupTable(rows);
      for (const [k, v] of parsedLookup) {
        lookupMap.set(k, v);
      }
      if (outposts.length > 0) {
        isLiveMain = true;
      }
    } catch (_) {}
  }

  if (LOOKUP_CSV_URL) {
    try {
      const lkpText = await fetchWithTimeout(LOOKUP_CSV_URL + "&_t=" + Date.now());
      const lkpRows = parseCSV(lkpText);
      const dedicatedLookup = parseLookupTable(lkpRows);
      if (dedicatedLookup.size > 0) {
        lookupMap = dedicatedLookup;
      }
    } catch (_) {}
  }

  if (isLiveMain && outposts.length > 0) {
    applyData(outposts, lookupMap, "Live Google Sheet CSV", "live");
    return;
  }

  const fallbackOutposts = parseTradingPostSheet(EMBEDDED_MAIN_ROWS);
  if (fallbackOutposts.length > 0) {
    applyData(fallbackOutposts, lookupMap, "Embedded Snapshot (Offline / CORS fallback)", "fallback");
  } else {
    statusDot.className = "status-dot error";
    statusText.textContent = "Unable to load Trading Post data";
    leftList.innerHTML = '<div class="empty-msg">Failed to load data. Check network or Google Sheet publish settings.</div>';
  }
}

function populateDropdowns() {
  const prevOrigin = state.selectedOrigin;
  originSelect.innerHTML = '<option value="ALL">All Outposts (' + state.allGoods.length + ' Packs)</option>';
  for (const op of state.outposts) {
    const opt = document.createElement("option");
    opt.value = op.name;
    opt.textContent = op.name + " (" + op.dispatch.length + " Dispatch)";
    originSelect.appendChild(opt);
  }
  originSelect.value = prevOrigin;

  const prevDest = state.selectedDest;
  destSelect.innerHTML = "";
  for (const op of state.outposts) {
    const opt = document.createElement("option");
    opt.value = op.name;
    opt.textContent = op.name;
    destSelect.appendChild(opt);
  }
  destSelect.value = prevDest;

  updateGoodDropdown();
}

function updateGoodDropdown() {
  let filtered = state.allGoods;
  if (state.selectedOrigin !== "ALL") {
    filtered = filtered.filter(g => g.originOutpost === state.selectedOrigin);
  }

  const prevGood = state.selectedGood;
  goodSelect.innerHTML = "";

  for (const g of filtered) {
    const lkp = getLookupEntry(g, state.lookupMap);
    let priceTag = "";
    if (lkp && lkp.buyPriceGold !== null) {
      const tag = lkp.costSource === "packing" ? "Pack" : "Cost";
      priceTag = " · " + tag + ": " + lkp.buyPriceGold.toLocaleString() + "G";
    }
    const opt = document.createElement("option");
    opt.value = g.name;
    opt.textContent = g.name + " (" + g.region + ")" + priceTag;
    goodSelect.appendChild(opt);
  }

  if (filtered.some(g => g.name === prevGood)) {
    state.selectedGood = prevGood;
  } else if (filtered.length > 0) {
    state.selectedGood = filtered[0].name;
  } else {
    state.selectedGood = "";
  }
  goodSelect.value = state.selectedGood;

  document.getElementById("goodCount").textContent = filtered.length + " available";
}

function renderLeftPanel() {
  const destOp = state.outposts.find(o => o.name === state.selectedDest);
  if (!destOp) return;

  leftList.innerHTML = "";
  saleControls.style.display = "block";
  const q = state.searchQuery.toLowerCase();

  const items = destOp.sales.filter(item => {
    if (state.rewardFilter !== "all" && item.reward.type !== state.rewardFilter) return false;
    if (q && !item.good.toLowerCase().includes(q) && !item.region.toLowerCase().includes(q)) return false;
    if (state.selectedOrigin !== "ALL") {
      const gObj = state.allGoods.find(g => g.key === item.key || g.name === item.good);
      const itemOrigin = (gObj && gObj.originOutpost) || resolveOutpostFromRegion(item.region);
      if (itemOrigin !== state.selectedOrigin) return false;
    }
    return true;
  });

  if (!items.length) {
    const originHint = state.selectedOrigin !== "ALL"
      ? " from " + escapeHtml(state.selectedOrigin)
      : "";
    leftList.innerHTML = '<div class="empty-msg">No matching trade goods at ' + escapeHtml(destOp.name) + originHint + '.</div>';
    return;
  }

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "good-row" + (item.good === state.selectedGood ? " selected" : "");
    const imgSrc = getPackImageSrc(item.good);
    btn.innerHTML =
      '<img class="good-row-bg" src="' + imgSrc + '" data-pack="' + escapeHtml(item.good) + '" alt="" loading="lazy" onerror="handlePackImgError(this, this.dataset.pack)" />' +
      '<div class="good-row-left">' +
        '<span class="good-origin">' + escapeHtml(item.region) + '</span>' +
        '<span class="good-name">' + escapeHtml(item.good) + '</span>' +
      '</div>' +
      '<span class="good-reward-tag ' + (item.reward.type === "gold" ? "gold" : "") + '">' +
        escapeHtml(formatRewardLabel(item.reward)) +
      '</span>';
    btn.addEventListener("click", () => {
      state.selectedGood = item.good;
      updateGoodDropdown();
      renderAll();
    });
    leftList.appendChild(btn);
  }
}

function formatSignedGold(val) {
  if (val > 0) return "+" + val.toLocaleString() + " G";
  if (val < 0) return val.toLocaleString() + " G";
  return "0 G";
}

function renderDetailsAndComparison() {
  const goodObj = state.allGoods.find(g => g.name === state.selectedGood);
  const destOp = state.outposts.find(o => o.name === state.selectedDest);

  const detailGoodName = document.getElementById("detailGoodName");
  const detailRouteBadge = document.getElementById("detailRouteBadge");
  const metaItemName = document.getElementById("metaItemName");
  const metaRegion = document.getElementById("metaRegion");
  const metaDispatchOutpost = document.getElementById("metaDispatchOutpost");
  const metaDestOutpost = document.getElementById("metaDestOutpost");
  const costSection = document.getElementById("costSection");
  const buyPriceText = document.getElementById("buyPriceText");
  const matsRow = document.getElementById("matsRow");
  const matsList = document.getElementById("matsList");
  const rewardBox = document.getElementById("rewardBox");
  const rewardValue = document.getElementById("rewardValue");
  const rewardSub = document.getElementById("rewardSub");
  const profitBox = document.getElementById("profitBox");
  const profitValue = document.getElementById("profitValue");
  const profitSub = document.getElementById("profitSub");
  const comparisonBody = document.getElementById("comparisonBody");

  if (!goodObj || !destOp) {
    detailGoodName.textContent = "No Trade Good Selected";
    costSection.style.display = "none";
    profitBox.style.display = "none";
    comparisonBody.innerHTML = "";
    return;
  }

  const saleEntry = destOp.sales.find(s => s.key === goodObj.key);
  const lkp = getLookupEntry(goodObj, state.lookupMap);
  const buyPrice = (lkp && lkp.buyPriceGold !== null) ? lkp.buyPriceGold : null;
  const materials = (lkp && Array.isArray(lkp.materials)) ? lkp.materials : [];

  detailGoodName.textContent = goodObj.name;
  detailRouteBadge.textContent = goodObj.originOutpost + " → " + destOp.name;
  metaItemName.textContent = goodObj.name;
  metaRegion.textContent = goodObj.region;
  metaDispatchOutpost.textContent = goodObj.originOutpost;
  metaDestOutpost.textContent = destOp.name;

  // Display effective cost (Cost if >0, else Packing Cost) + materials with qty
  if (buyPrice !== null || materials.length > 0) {
    costSection.style.display = "flex";
    if (buyPrice !== null) {
      const srcLabel = (lkp && lkp.costSource === "packing") ? "Packing Cost" : "Buy Cost";
      buyPriceText.textContent = buyPrice.toLocaleString() + " G";
      const costLabelEl = costSection.querySelector(".reward-label");
      if (costLabelEl) costLabelEl.textContent = srcLabel + " (Lookup)";
    } else {
      buyPriceText.textContent = "—";
    }
    if (materials.length > 0) {
      matsRow.style.display = "flex";
      matsList.innerHTML = materials.map(m => {
        if (typeof m === "string") {
          return '<span class="mat-chip">' + escapeHtml(m) + '</span>';
        }
        const qtyStr = (m.qty != null && m.qty > 0) ? (" ×" + m.qty) : "";
        return '<span class="mat-chip">' + escapeHtml(m.name) + qtyStr + '</span>';
      }).join("");
    } else {
      matsRow.style.display = "none";
      matsList.innerHTML = "";
    }
  } else {
    costSection.style.display = "none";
    matsRow.style.display = "none";
    matsList.innerHTML = "";
  }

  rewardBox.className = "reward-box";
  profitBox.style.display = "none";

  if (!saleEntry) {
    rewardValue.innerHTML = '<span style="color:var(--text-secondary); font-size:1.05rem;">Not sold at ' + escapeHtml(destOp.name) + ' (Home / Origin Post)</span>';
    rewardSub.textContent = "Select another Arrival Trading Post";
  } else if (saleEntry.reward.type === "gold") {
    rewardBox.classList.add("is-gold");
    rewardValue.innerHTML =
      '<span class="coin-badge">G</span>' +
      '<span class="reward-gold-text">' + saleEntry.reward.min.toLocaleString() + ' ~ ' + saleEntry.reward.max.toLocaleString() + '</span>';
    rewardSub.innerHTML = 'Mean payout: <strong class="mono text-gold">' + saleEntry.reward.avg.toLocaleString() + ' G</strong>';

    if (buyPrice !== null) {
      const netMin = saleEntry.reward.min - buyPrice;
      const netMax = saleEntry.reward.max - buyPrice;
      const netAvg = saleEntry.reward.avg - buyPrice;
      const roiPct = buyPrice > 0 ? ((netAvg / buyPrice) * 100).toFixed(1) : null;
      const cls = netAvg >= 0 ? "profit-pos" : "profit-neg";

      profitBox.style.display = "flex";
      profitBox.className = "reward-box " + (netAvg >= 0 ? "is-gold" : "is-item");
      profitValue.innerHTML = '<span class="mono ' + cls + '">' + formatSignedGold(netMin) + ' ~ ' + formatSignedGold(netMax) + '</span>';
      profitSub.innerHTML =
        'Avg Net: <strong class="mono ' + cls + '">' + formatSignedGold(netAvg) + '</strong>' +
        (roiPct !== null ? ' · ROI: <strong class="mono ' + cls + '">' + (netAvg >= 0 ? "+" : "") + roiPct + '%</strong>' : '');
    }
  } else {
    rewardBox.classList.add("is-item");
    const range = getItemQtyRange(saleEntry.reward);
    const qtyLabel = range
      ? ('×' + (range.max > range.min ? (range.min + ' ~ ' + range.max) : range.min) + ' ')
      : '';
    rewardValue.innerHTML = '<span class="reward-item-text">' + escapeHtml(qtyLabel + saleEntry.reward.raw) + '</span>';
    rewardSub.textContent = range
      ? ("Material / Item Reward (100% base: " + range.min + " · 140% max: " + range.max + " per pack)")
      : "Material / Item Reward (100% ~ 140% range)";
  }

  comparisonBody.innerHTML = "";
  for (const op of state.outposts) {
    const match = op.sales.find(s => s.key === goodObj.key);
    const tr = document.createElement("tr");
    if (op.name === destOp.name) {
      tr.className = "current-dest";
    }

    if (!match) {
      tr.innerHTML =
        '<td>' + escapeHtml(op.name) + '</td>' +
        '<td style="color:var(--text-muted);">Origin Outpost</td>' +
        '<td style="color:var(--text-muted);">—</td>' +
        '<td style="color:var(--text-muted);">—</td>' +
        '<td style="color:var(--text-muted);">—</td>';
    } else if (match.reward.type === "gold") {
      let netCell = '<td style="color:var(--text-muted);">—</td>';
      if (buyPrice !== null) {
        const netAvg = match.reward.avg - buyPrice;
        const cls = netAvg >= 0 ? "profit-pos" : "profit-neg";
        netCell = '<td class="mono ' + cls + '"><strong>' + formatSignedGold(netAvg) + '</strong></td>';
      }
      tr.innerHTML =
        '<td>' + escapeHtml(op.name) + '</td>' +
        '<td class="text-gold">Gold</td>' +
        '<td class="mono text-gold">' + match.reward.min.toLocaleString() + ' ~ ' + match.reward.max.toLocaleString() + ' G</td>' +
        '<td class="mono">' + match.reward.avg.toLocaleString() + ' G</td>' +
        netCell;
    } else {
      tr.innerHTML =
        '<td>' + escapeHtml(op.name) + '</td>' +
        '<td class="text-item">Material / Item</td>' +
        '<td class="text-item">' + escapeHtml(formatRewardLabel(match.reward)) + '</td>' +
        '<td style="color:var(--text-muted);">—</td>' +
        '<td style="color:var(--text-muted);">—</td>';
    }

    tr.addEventListener("click", () => {
      state.selectedDest = op.name;
      destSelect.value = op.name;
      renderAll();
    });

    comparisonBody.appendChild(tr);
  }
}

const RUN_CAPACITY = 7;

function getSaleRewardForGood(goodName, destName) {
  const goodObj = state.allGoods.find(g => g.name === goodName);
  const destOp = state.outposts.find(o => o.name === destName);
  if (!goodObj || !destOp) return null;
  return destOp.sales.find(s => s.key === goodObj.key) || null;
}

function renderRunSimulation() {
  const slotsEl = document.getElementById("runSlots");
  const capLabel = document.getElementById("runCapacityLabel");
  if (!slotsEl || !capLabel) return;

  const n = state.runSlots.length;
  capLabel.textContent = n + " / " + RUN_CAPACITY + " packs";

  slotsEl.innerHTML = "";
  for (let i = 0; i < RUN_CAPACITY; i++) {
    const name = state.runSlots[i] || null;
    const div = document.createElement("div");
    div.className = "run-slot" + (name ? " filled" : "");

    if (name) {
      const goodObj = state.allGoods.find(g => g.name === name);
      const lkp = goodObj ? getLookupEntry(goodObj, state.lookupMap) : null;
      const price = (lkp && lkp.buyPriceGold !== null) ? lkp.buyPriceGold.toLocaleString() + "G" : "—";
      const imgSrc = getPackImageSrc(name);
      div.innerHTML =
        '<button type="button" class="run-slot-remove" data-idx="' + i + '" title="Remove">×</button>' +
        '<img class="run-slot-img" src="' + imgSrc + '" data-pack="' + escapeHtml(name) + '" alt="" onerror="handlePackImgError(this, this.dataset.pack)" />' +
        '<span class="run-slot-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>' +
        '<span class="run-slot-price">' + escapeHtml(price) + '</span>';
    } else {
      div.innerHTML =
        '<span class="run-slot-idx">#' + (i + 1) + '</span>' +
        '<span class="run-slot-name" style="color:var(--text-muted);">Empty</span>';
    }
    slotsEl.appendChild(div);
  }

  slotsEl.querySelectorAll(".run-slot-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      state.runSlots.splice(idx, 1);
      renderRunSimulation();
    });
  });

  // Totals
  let totalCost = 0;
  let costKnown = true;
  let grossMin = 0, grossMax = 0, grossAvg = 0;
  let hasGold = false;
  const itemCounts = {};

  for (const name of state.runSlots) {
    const goodObj = state.allGoods.find(g => g.name === name);
    const lkp = goodObj ? getLookupEntry(goodObj, state.lookupMap) : null;
    if (lkp && lkp.buyPriceGold !== null) {
      totalCost += lkp.buyPriceGold;
    } else {
      costKnown = false;
    }

    const sale = getSaleRewardForGood(name, state.selectedDest);
    if (sale && sale.reward.type === "gold") {
      hasGold = true;
      grossMin += sale.reward.min;
      grossMax += sale.reward.max;
      grossAvg += sale.reward.avg;
    } else if (sale && sale.reward.type === "item") {
      const key = sale.reward.raw;
      const range = getItemQtyRange(sale.reward);
      const baseAdd = range ? range.min : 1;
      const maxAdd = range ? range.max : 1;
      if (!itemCounts[key]) {
        itemCounts[key] = { min: 0, max: 0, hasQty: Boolean(range) };
      }
      itemCounts[key].min += baseAdd;
      itemCounts[key].max += maxAdd;
    }
  }

  const costEl = document.getElementById("runTotalCost");
  const rangeEl = document.getElementById("runGrossRange");
  const avgEl = document.getElementById("runGrossAvg");
  const netEl = document.getElementById("runNetAvg");
  const roiEl = document.getElementById("runRoi");
  const itemsEl = document.getElementById("runItems");

  if (n === 0) {
    costEl.textContent = "—";
    rangeEl.textContent = "—";
    avgEl.textContent = "—";
    netEl.textContent = "—";
    netEl.className = "run-stat-value";
    roiEl.textContent = "—";
    roiEl.className = "run-stat-value";
    itemsEl.textContent = "—";
    return;
  }

  costEl.textContent = costKnown
    ? totalCost.toLocaleString() + " G"
    : (totalCost > 0 ? totalCost.toLocaleString() + " G+" : "unknown");

  if (hasGold) {
    rangeEl.textContent = grossMin.toLocaleString() + " ~ " + grossMax.toLocaleString() + " G";
    avgEl.textContent = grossAvg.toLocaleString() + " G";
    if (costKnown) {
      const net = grossAvg - totalCost;
      const cls = net >= 0 ? "profit-pos" : "profit-neg";
      netEl.className = "run-stat-value " + cls;
      netEl.textContent = formatSignedGold(net);
      if (totalCost > 0) {
        const roi = ((net / totalCost) * 100).toFixed(1);
        roiEl.className = "run-stat-value " + cls;
        roiEl.textContent = (net >= 0 ? "+" : "") + roi + "%";
      } else {
        roiEl.textContent = "—";
        roiEl.className = "run-stat-value";
      }
    } else {
      netEl.textContent = "need buy prices";
      netEl.className = "run-stat-value";
      roiEl.textContent = "—";
      roiEl.className = "run-stat-value";
    }
  } else {
    rangeEl.textContent = "—";
    avgEl.textContent = "—";
    netEl.textContent = "—";
    netEl.className = "run-stat-value";
    roiEl.textContent = "—";
    roiEl.className = "run-stat-value";
  }

  const itemParts = Object.keys(itemCounts).map(k => {
    const c = itemCounts[k];
    if (!c.hasQty) return k;
    const label = c.max > c.min ? (c.min + "~" + c.max) : String(c.min);
    return "×" + label + " " + k;
  });
  itemsEl.textContent = itemParts.length ? itemParts.join(", ") : (hasGold ? "none" : "—");
}

function addPackToRun(packName, count) {
  if (!packName) return;
  const room = RUN_CAPACITY - state.runSlots.length;
  if (room <= 0) return;
  const n = Math.min(count || 1, room);
  for (let i = 0; i < n; i++) state.runSlots.push(packName);
  renderRunSimulation();
}

function renderAll() {
  renderMap();
  renderLeftPanel();
  renderDetailsAndComparison();
  renderRunSimulation();
}

function getPackImageSrc(packName) {
  if (!packName) return "";
  const canonical = packName.replace(/Trade Box$/i, "Trade Goods").trim();
  const noSpaces = canonical.replace(/\s+/g, "");
  return "imgs/tradepacks/" + encodeURIComponent(noSpaces) + ".webp";
}

function getPackImageFallbackSrc(packName) {
  if (!packName) return "";
  const canonical = packName.replace(/Trade Box$/i, "Trade Goods").trim();
  const alphanumericOnly = canonical.replace(/[^a-zA-Z0-9]/g, "");
  return "imgs/tradepacks/" + encodeURIComponent(alphanumericOnly) + ".webp";
}

function handlePackImgError(imgEl, packName) {
  if (!imgEl || !packName) return;
  if (!imgEl.dataset.fallbackTried) {
    imgEl.dataset.fallbackTried = "1";
    const fb = getPackImageFallbackSrc(packName);
    if (fb && imgEl.getAttribute("src") !== fb) {
      imgEl.setAttribute("src", fb);
      return;
    }
  }
  imgEl.style.display = "none";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """);
}

originSelect.addEventListener("change", () => {
  state.selectedOrigin = originSelect.value;
  updateGoodDropdown();
  renderAll();
});

goodSelect.addEventListener("change", () => {
  state.selectedGood = goodSelect.value;
  renderAll();
});

destSelect.addEventListener("change", () => {
  state.selectedDest = destSelect.value;
  renderAll();
});

document.getElementById("refreshBtn").addEventListener("click", loadSheetData);

document.getElementById("swapBtn").addEventListener("click", () => {
  if (state.selectedOrigin === "ALL") {
    const goodObj = state.allGoods.find(g => g.name === state.selectedGood);
    if (goodObj && state.outposts.some(o => o.name === goodObj.originOutpost)) {
      const prevDest = state.selectedDest;
      state.selectedDest = goodObj.originOutpost;
      destSelect.value = state.selectedDest;
      state.selectedOrigin = prevDest;
      originSelect.value = prevDest;
      updateGoodDropdown();
      renderAll();
    }
    return;
  }
  const temp = state.selectedOrigin;
  state.selectedOrigin = state.selectedDest;
  state.selectedDest = temp;
  originSelect.value = state.selectedOrigin;
  destSelect.value = state.selectedDest;
  updateGoodDropdown();
  renderAll();
});

document.querySelectorAll(".pill").forEach(pill => {
  pill.addEventListener("click", () => {
    document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    state.rewardFilter = pill.dataset.filter;
    renderLeftPanel();
  });
});

searchInput.addEventListener("input", () => {
  state.searchQuery = searchInput.value;
  renderLeftPanel();
});

document.addEventListener("keydown", e => {
  if (document.activeElement === searchInput) {
    if (e.key === "Escape") searchInput.blur();
    return;
  }
  if (e.key === "r" || e.key === "R") {
    loadSheetData();
  } else if (e.key === "x" || e.key === "X") {
    document.getElementById("swapBtn").click();
  } else if (e.key === "/") {
    e.preventDefault();
    searchInput.focus();
  }
});


document.getElementById("runAddOneBtn").addEventListener("click", () => {
  if (!state.selectedGood) return;
  if (state.runSlots.length >= RUN_CAPACITY) return;
  addPackToRun(state.selectedGood, 1);
});

document.getElementById("runFillBtn").addEventListener("click", () => {
  if (!state.selectedGood) return;
  const room = RUN_CAPACITY - state.runSlots.length;
  if (room <= 0) {
    // replace all with selected
    state.runSlots = Array(RUN_CAPACITY).fill(state.selectedGood);
    renderRunSimulation();
    return;
  }
  addPackToRun(state.selectedGood, room);
});

document.getElementById("runClearBtn").addEventListener("click", () => {
  state.runSlots = [];
  renderRunSimulation();
});


// ============================================================================
// INTERACTIVE WORLD MAP (6232 x 4712 native image coordinate space)
// ============================================================================
const MAP_WIDTH = 6232;
const MAP_HEIGHT = 4712;

// Outpost (x, y) pixel coordinates on worldmap.webp (6232 x 4712).
// Hover the map to read (x, y) or click the map background to copy { x: ..., y: ... }.
const OUTPOST_COORDS = {
  "Seaglass Harbor Trading Post":     { x: 4965, y: 3672 },
  "Watcher's Trading Post":           { x: 4330, y: 3331 },
  "Jubilant Village Trading Post":    { x: 2221, y: 3278 },
  "Waterdrift Trading Post":          { x: 2620, y: 1787 },
  "Stargazer Trading Post":           { x: 4420, y: 1981 },
  "Shadowpath Temple Trading Post":   { x: 4422, y: 940 }
};

// Explicit "Departure -> Arrival" mapping to transparent SVG route overlays.
const ROUTE_OVERLAYS = {
  // From Seaglass Harbor Trading Post
  "Seaglass Harbor Trading Post->Watcher's Trading Post": "imgs/routes/seaglass_harbor_to_watchers.svg",
  "Seaglass Harbor Trading Post->Jubilant Village Trading Post": "imgs/routes/seaglass_harbor_to_jubilant_village.svg",
  "Seaglass Harbor Trading Post->Waterdrift Trading Post": "imgs/routes/seaglass_harbor_to_waterdrift.svg",
  "Seaglass Harbor Trading Post->Stargazer Trading Post": "imgs/routes/seaglass_harbor_to_stargazer.svg",
  "Seaglass Harbor Trading Post->Shadowpath Temple Trading Post": "imgs/routes/seaglass_harbor_to_shadowpath_temple.svg",

  // From Watcher's Trading Post
  "Watcher's Trading Post->Seaglass Harbor Trading Post": "imgs/routes/seaglass_harbor_to_watchers.svg",
  "Watcher's Trading Post->Jubilant Village Trading Post": "imgs/routes/watchers_to_jubilant_village.svg",
  "Watcher's Trading Post->Waterdrift Trading Post": "imgs/routes/watchers_to_waterdrift.svg",
  "Watcher's Trading Post->Stargazer Trading Post": "imgs/routes/watchers_to_stargazer.svg",
  "Watcher's Trading Post->Shadowpath Temple Trading Post": "imgs/routes/watchers_to_shadowpath_temple.svg",

  // From Jubilant Village Trading Post
  "Jubilant Village Trading Post->Seaglass Harbor Trading Post": "imgs/routes/seaglass_harbor_to_jubilant_village.svg",
  "Jubilant Village Trading Post->Watcher's Trading Post": "imgs/routes/watchers_to_jubilant_village.svg",
  "Jubilant Village Trading Post->Waterdrift Trading Post": "imgs/routes/jubilant_village_to_waterdrift.svg",
  "Jubilant Village Trading Post->Stargazer Trading Post": "imgs/routes/jubilant_village_to_stargazer.svg",
  "Jubilant Village Trading Post->Shadowpath Temple Trading Post": "imgs/routes/jubilant_village_to_shadowpath_temple.svg",

  // From Waterdrift Trading Post
  "Waterdrift Trading Post->Seaglass Harbor Trading Post": "imgs/routes/seaglass_harbor_to_waterdrift.svg",
  "Waterdrift Trading Post->Watcher's Trading Post": "imgs/routes/watchers_to_waterdrift.svg",
  "Waterdrift Trading Post->Jubilant Village Trading Post": "imgs/routes/jubilant_village_to_waterdrift.svg",
  "Waterdrift Trading Post->Stargazer Trading Post": "imgs/routes/stargazer_to_waterdrift.svg",
  "Waterdrift Trading Post->Shadowpath Temple Trading Post": "imgs/routes/shadowpath_temple_to_waterdrift.svg",

  // From Stargazer Trading Post
  "Stargazer Trading Post->Seaglass Harbor Trading Post": "imgs/routes/seaglass_harbor_to_stargazer.svg",
  "Stargazer Trading Post->Watcher's Trading Post": "imgs/routes/watchers_to_stargazer.svg",
  "Stargazer Trading Post->Jubilant Village Trading Post": "imgs/routes/jubilant_village_to_stargazer.svg",
  "Stargazer Trading Post->Waterdrift Trading Post": "imgs/routes/stargazer_to_waterdrift.svg",
  "Stargazer Trading Post->Shadowpath Temple Trading Post": "imgs/routes/stargazer_to_shadowpath_temple.svg",

  // From Shadowpath Temple Trading Post
  "Shadowpath Temple Trading Post->Seaglass Harbor Trading Post": "imgs/routes/seaglass_harbor_to_shadowpath_temple.svg",
  "Shadowpath Temple Trading Post->Watcher's Trading Post": "imgs/routes/watchers_to_shadowpath_temple.svg",
  "Shadowpath Temple Trading Post->Jubilant Village Trading Post": "imgs/routes/jubilant_village_to_shadowpath_temple.svg",
  "Shadowpath Temple Trading Post->Waterdrift Trading Post": "imgs/routes/shadowpath_temple_to_waterdrift.svg",
  "Shadowpath Temple Trading Post->Stargazer Trading Post": "imgs/routes/stargazer_to_shadowpath_temple.svg"
};

function slugifyOutpost(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/trading post/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getEffectiveDepartureOutpost() {
  if (state.selectedOrigin && state.selectedOrigin !== "ALL") {
    return state.selectedOrigin;
  }
  const goodObj = state.allGoods.find(g => g.name === state.selectedGood);
  return goodObj ? goodObj.originOutpost : "";
}

function getRouteOverlayCandidates(originName, destName) {
  if (!originName || !destName || originName === destName) return [];
  const keyDirect = originName + "->" + destName;
  if (ROUTE_OVERLAYS[keyDirect]) {
    return [ROUTE_OVERLAYS[keyDirect]];
  }
  const oSlug = slugifyOutpost(originName);
  const dSlug = slugifyOutpost(destName);
  return [
    "imgs/routes/" + oSlug + "_to_" + dSlug + ".svg",
    "imgs/routes/" + dSlug + "_to_" + oSlug + ".svg",
    "imgs/routes/" + oSlug + "_to_" + dSlug + ".webp",
    "imgs/routes/" + dSlug + "_to_" + oSlug + ".webp"
  ];
}

const mapState = {
  scale: 0.08,
  minScale: 0.04,
  maxScale: 1.5,
  tx: 0,
  ty: 0,
  isDragging: false,
  dragMoved: false,
  startX: 0,
  startY: 0,
  startTx: 0,
  startTy: 0,
  initialized: false
};

const mapWidget = document.getElementById("mapWidget");
const mapViewport = document.getElementById("mapViewport");
const mapStage = document.getElementById("mapStage");
const mapMarkersLayer = document.getElementById("mapMarkersLayer");
const routeOverlayImg = document.getElementById("routeOverlayImg");
const routeInlineContainer = document.getElementById("routeInlineContainer");
const mapCoordsReadout = document.getElementById("mapCoordsReadout");
const mapRouteLabel = document.getElementById("mapRouteLabel");

function clampMapTransform() {
  if (!mapViewport) return;
  const vw = mapViewport.clientWidth || 348;
  const vh = mapViewport.clientHeight || 270;
  const minFit = Math.min(vw / MAP_WIDTH, vh / MAP_HEIGHT) * 0.85;
  mapState.minScale = Math.max(0.03, minFit);
  mapState.scale = Math.min(mapState.maxScale, Math.max(mapState.minScale, mapState.scale));

  const sw = MAP_WIDTH * mapState.scale;
  const sh = MAP_HEIGHT * mapState.scale;
  const margin = 60;

  if (sw <= vw) {
    mapState.tx = (vw - sw) / 2;
  } else {
    mapState.tx = Math.min(margin, Math.max(vw - sw - margin, mapState.tx));
  }

  if (sh <= vh) {
    mapState.ty = (vh - sh) / 2;
  } else {
    mapState.ty = Math.min(margin, Math.max(vh - sh - margin, mapState.ty));
  }
}

function applyMapTransform() {
  if (!mapStage) return;
  clampMapTransform();
  mapStage.style.transform =
    "translate3d(" + mapState.tx.toFixed(2) + "px, " + mapState.ty.toFixed(2) + "px, 0) scale(" + mapState.scale.toFixed(5) + ")";
  // Keep outpost marker icons at a readable screen size while anchored to exact (x, y)
  const invScale = Math.min(28, Math.max(0.85, 1 / mapState.scale));
  mapStage.style.setProperty("--inv-scale", invScale.toFixed(4));
}

function zoomMapAt(factor, clientX, clientY) {
  if (!mapViewport) return;
  const rect = mapViewport.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;

  const worldX = (px - mapState.tx) / mapState.scale;
  const worldY = (py - mapState.ty) / mapState.scale;

  const nextScale = Math.min(mapState.maxScale, Math.max(mapState.minScale, mapState.scale * factor));
  mapState.scale = nextScale;
  mapState.tx = px - worldX * nextScale;
  mapState.ty = py - worldY * nextScale;
  applyMapTransform();
}

function fitMapToView(focusPoints) {
  if (!mapViewport) return;
  const vw = mapViewport.clientWidth || 348;
  const vh = mapViewport.clientHeight || 270;

  if (Array.isArray(focusPoints) && focusPoints.length >= 2) {
    const xs = focusPoints.map(p => p.x);
    const ys = focusPoints.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const boxW = Math.max(650, maxX - minX);
    const boxH = Math.max(500, maxY - minY);
    const pad = 1.65;
    const targetScale = Math.min(vw / (boxW * pad), vh / (boxH * pad), 0.45);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    mapState.scale = targetScale;
    mapState.tx = vw / 2 - cx * mapState.scale;
    mapState.ty = vh / 2 - cy * mapState.scale;
  } else {
    mapState.scale = Math.min(vw / MAP_WIDTH, vh / MAP_HEIGHT);
    mapState.tx = (vw - MAP_WIDTH * mapState.scale) / 2;
    mapState.ty = (vh - MAP_HEIGHT * mapState.scale) / 2;
  }
  applyMapTransform();
}

function clearRouteDisplay() {
  if (routeInlineContainer) routeInlineContainer.innerHTML = "";
  if (routeOverlayImg) {
    routeOverlayImg.style.display = "none";
    routeOverlayImg.removeAttribute("src");
  }
}

async function renderInlineSvgRoute(url) {
  if (!routeInlineContainer || !url.toLowerCase().endsWith(".svg")) return false;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return false;
    const svgText = await res.text();
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (doc.querySelector("parsererror")) return false;
    const svgEl = doc.querySelector("svg");
    if (!svgEl) return false;

    if (!svgEl.getAttribute("viewBox")) {
      svgEl.setAttribute("viewBox", "0 0 " + MAP_WIDTH + " " + MAP_HEIGHT);
    }
    svgEl.setAttribute("width", String(MAP_WIDTH));
    svgEl.setAttribute("height", String(MAP_HEIGHT));

    svgEl.querySelectorAll("path, polyline, polygon, line, circle, ellipse, rect").forEach(el => {
      el.setAttribute("vector-effect", "non-scaling-stroke");
    });

    routeInlineContainer.innerHTML = "";
    routeInlineContainer.appendChild(document.importNode(svgEl, true));
    if (routeOverlayImg) {
      routeOverlayImg.style.display = "none";
      routeOverlayImg.removeAttribute("src");
    }
    return true;
  } catch (_) {
    return false;
  }
}

function updateRouteOverlay(originName, destName) {
  if (!mapRouteLabel) return;
  const candidates = getRouteOverlayCandidates(originName, destName);
  if (!candidates.length) {
    clearRouteDisplay();
    mapRouteLabel.textContent = originName && destName && originName === destName
      ? "Same departure & arrival"
      : "Select departure & arrival";
    return;
  }

  const shortOrigin = originName.replace(/ Trading Post$/i, "");
  const shortDest = destName.replace(/ Trading Post$/i, "");
  mapRouteLabel.textContent = shortOrigin + " → " + shortDest;

  clearRouteDisplay();
  const requestToken = Symbol("route");
  updateRouteOverlay._token = requestToken;

  (async () => {
    for (const src of candidates) {
      if (updateRouteOverlay._token !== requestToken) return;
      if (src.toLowerCase().endsWith(".svg")) {
        const ok = await renderInlineSvgRoute(src);
        if (ok) return;
      }
    }

    if (updateRouteOverlay._token !== requestToken || !routeOverlayImg) return;
    let idx = 0;
    function tryImgNext() {
      if (updateRouteOverlay._token !== requestToken) return;
      if (idx >= candidates.length) {
        routeOverlayImg.style.display = "none";
        return;
      }
      const imgSrc = candidates[idx++];
      routeOverlayImg.onerror = tryImgNext;
      routeOverlayImg.onload = () => {
        if (updateRouteOverlay._token === requestToken) {
          routeOverlayImg.style.display = "block";
        }
      };
      routeOverlayImg.src = imgSrc;
    }
    tryImgNext();
  })();
}

function renderMap() {
  if (!mapMarkersLayer) return;

  const activeOrigin = getEffectiveDepartureOutpost();
  const activeDest = state.selectedDest;

  // Build list of outposts to display (from loaded sheet + any configured coordinates)
  const names = new Set(Object.keys(OUTPOST_COORDS));
  for (const op of state.outposts) {
    names.add(op.name);
  }

  mapMarkersLayer.innerHTML = "";
  const activePts = [];

  for (const name of names) {
    const coord = OUTPOST_COORDS[name];
    if (!coord) continue;

    const isOrigin = name === activeOrigin;
    const isDest = name === activeDest && activeDest !== activeOrigin;
    if (isOrigin || isDest) activePts.push(coord);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "map-marker" + (isOrigin ? " is-origin" : "") + (isDest ? " is-dest" : "");
    btn.style.left = coord.x + "px";
    btn.style.top = coord.y + "px";
    btn.title = name + " (" + coord.x + ", " + coord.y + ") — Click: Arrival | Shift+Click: Departure";

    const shortName = name.replace(/ Trading Post$/i, "");
    const badgeHtml = isOrigin
      ? '<span class="map-marker-badge">DEP</span>'
      : (isDest ? '<span class="map-marker-badge">ARR</span>' : "");

    btn.innerHTML =
      '<div class="map-marker-icon-wrap">' +
        '<img class="map-marker-icon" src="imgs/outpost.webp" alt="" />' +
        badgeHtml +
      '</div>' +
      '<span class="map-marker-label">' + escapeHtml(shortName) + '</span>';

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.outposts.some(o => o.name === name)) return;
      if (e.shiftKey) {
        state.selectedOrigin = name;
        originSelect.value = name;
        updateGoodDropdown();
      } else {
        state.selectedDest = name;
        destSelect.value = name;
      }
      renderAll();
    });

    mapMarkersLayer.appendChild(btn);
  }

  updateRouteOverlay(activeOrigin, activeDest);

  if (!mapState.initialized) {
    mapState.initialized = true;
    fitMapToView(null);
  } else {
    applyMapTransform();
  }
}

if (mapViewport) {
  mapViewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.22 : 1 / 1.22;
    zoomMapAt(factor, e.clientX, e.clientY);
  }, { passive: false });

  mapViewport.addEventListener("dblclick", (e) => {
    zoomMapAt(1.6, e.clientX, e.clientY);
  });

  mapViewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".map-marker")) return;
    mapState.isDragging = true;
    mapState.dragMoved = false;
    mapState.startX = e.clientX;
    mapState.startY = e.clientY;
    mapState.startTx = mapState.tx;
    mapState.startTy = mapState.ty;
    mapViewport.classList.add("dragging");
    mapViewport.setPointerCapture(e.pointerId);
  });

  mapViewport.addEventListener("pointermove", (e) => {
    const rect = mapViewport.getBoundingClientRect();
    const wx = Math.round((e.clientX - rect.left - mapState.tx) / mapState.scale);
    const wy = Math.round((e.clientY - rect.top - mapState.ty) / mapState.scale);
    if (mapCoordsReadout && wx >= 0 && wx <= MAP_WIDTH && wy >= 0 && wy <= MAP_HEIGHT) {
      mapCoordsReadout.textContent = "x: " + wx + ", y: " + wy;
    }

    if (!mapState.isDragging) return;
    const dx = e.clientX - mapState.startX;
    const dy = e.clientY - mapState.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      mapState.dragMoved = true;
    }
    mapState.tx = mapState.startTx + dx;
    mapState.ty = mapState.startTy + dy;
    applyMapTransform();
  });

  const endDrag = (e) => {
    if (!mapState.isDragging) return;
    if (!mapState.dragMoved && mapCoordsReadout) {
      const rect = mapViewport.getBoundingClientRect();
      const wx = Math.round((e.clientX - rect.left - mapState.tx) / mapState.scale);
      const wy = Math.round((e.clientY - rect.top - mapState.ty) / mapState.scale);
      if (wx >= 0 && wx <= MAP_WIDTH && wy >= 0 && wy <= MAP_HEIGHT) {
        const snippet = "{ x: " + wx + ", y: " + wy + " }";
        mapCoordsReadout.textContent = "Copied " + snippet;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(snippet).catch(() => {});
        }
      }
    }
    mapState.isDragging = false;
    mapViewport.classList.remove("dragging");
  };

  mapViewport.addEventListener("pointerup", endDrag);
  mapViewport.addEventListener("pointercancel", endDrag);
}

document.getElementById("mapZoomInBtn")?.addEventListener("click", () => {
  const rect = mapViewport.getBoundingClientRect();
  zoomMapAt(1.3, rect.left + rect.width / 2, rect.top + rect.height / 2);
});

document.getElementById("mapZoomOutBtn")?.addEventListener("click", () => {
  const rect = mapViewport.getBoundingClientRect();
  zoomMapAt(1 / 1.3, rect.left + rect.width / 2, rect.top + rect.height / 2);
});

document.getElementById("mapFitBtn")?.addEventListener("click", () => {
  const o = getEffectiveDepartureOutpost();
  const d = state.selectedDest;
  const pts = [];
  if (o && OUTPOST_COORDS[o]) pts.push(OUTPOST_COORDS[o]);
  if (d && d !== o && OUTPOST_COORDS[d]) pts.push(OUTPOST_COORDS[d]);
  fitMapToView(pts.length >= 2 ? pts : null);
});

document.getElementById("mapExpandBtn")?.addEventListener("click", () => {
  if (!mapWidget) return;
  mapWidget.classList.toggle("expanded");
  setTimeout(() => applyMapTransform(), 210);
});

function syncMapViewportSize() {
  if (!mapViewport || !mapWidget) return;
  if (!mapWidget.classList.contains("expanded")) {
    const w = mapViewport.clientWidth;
    if (w > 0) {
      mapViewport.style.height = w + "px";
    }
  }
  if (!mapState.initialized) {
    fitMapToView(null);
  } else {
    applyMapTransform();
  }
}

if (typeof ResizeObserver !== "undefined" && mapViewport) {
  new ResizeObserver(() => syncMapViewportSize()).observe(mapViewport);
}
syncMapViewportSize();

window.addEventListener("resize", () => applyMapTransform());

loadSheetData();
