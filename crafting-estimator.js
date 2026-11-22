/**
 * crafting-estimator.js
 * Module autonome de résolution récursive des recettes de craft (Craft/Recipes + Lookup)
 * et d'estimation des coûts/ressources pour 1 pack ou une charrette complète (7 packs).
 */
(function (global) {
  "use strict";

  const DEFAULT_MAX_WAGON_SLOTS = 7;

  /**
   * Normalise un nom d'item pour éviter les écarts de casse, d'espaces
   * ou de pluriel simple (ex. "Bone Chip" vs "Bone Chips").
   */
  function normalizeItemKey(name) {
    let key = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

    if (key.length > 3 && key.endsWith("s") && !key.endsWith("ss")) {
      key = key.slice(0, -1);
    }
    return key;
  }

  /**
   * Parse un texte CSV en tableau de lignes (gère les guillemets doubles).
   */
  function parseCsvRows(csvText) {
    const rows = [];
    let currentRow = [];
    let currentVal = "";
    let inQuotes = false;

    const text = String(csvText || "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"') {
        if (inQuotes && next === '"') {
          currentVal += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        currentRow.push(currentVal.trim());
        currentVal = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i++;
        currentRow.push(currentVal.trim());
        if (currentRow.some((cell) => cell !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentVal = "";
      } else {
        currentVal += ch;
      }
    }

    if (currentVal.length > 0 || currentRow.length > 0) {
      currentRow.push(currentVal.trim());
      if (currentRow.some((cell) => cell !== "")) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  /**
   * Parse l'onglet "Craft/Recipes" :
   * Result Item | Result Qty | Craft Gold | Ingredient | Ingredient Qty
   */
  function buildCraftRecipeMap(csvText) {
    const rows = parseCsvRows(csvText);
    if (rows.length <= 1) return new Map();

    const header = rows[0].map((h) => h.toLowerCase().trim());
    const idxResult = header.indexOf("result item");
    const idxResultQty = header.indexOf("result qty");
    const idxCraftGold = header.indexOf("craft gold");
    const idxIngredient = header.indexOf("ingredient");
    const idxIngredientQty = header.indexOf("ingredient qty");

    const recipes = new Map();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const resultItem = (row[idxResult] || "").trim();
      const ingredient = (row[idxIngredient] || "").trim();
      if (!resultItem || !ingredient) continue;

      const resultQty = Math.max(1, Number(row[idxResultQty]) || 1);
      const craftGold = Math.max(0, Number(row[idxCraftGold]) || 0);
      const ingredientQty = Math.max(0, Number(row[idxIngredientQty]) || 0);
      const resultKey = normalizeItemKey(resultItem);
      const ingredientKey = normalizeItemKey(ingredient);

      if (!recipes.has(resultKey)) {
        recipes.set(resultKey, {
          resultItem,
          resultQty,
          craftGold,
          ingredients: []
        });
      }

      const entry = recipes.get(resultKey);
      if (row[idxResultQty] !== undefined && row[idxResultQty] !== "") {
        entry.resultQty = resultQty;
      }
      if (row[idxCraftGold] !== undefined && row[idxCraftGold] !== "") {
        entry.craftGold = craftGold;
      }

      entry.ingredients.push({
        name: ingredient,
        key: ingredientKey,
        qty: ingredientQty
      });
    }

    return recipes;
  }

  /**
   * Parse l'onglet "Lookup" avec les colonnes :
   * Trade Goods for Sale | Trademark Region | Cost | Packing Cost |
   * Material 1 | Quantity | Arcane Sealed Chest | Blank Trade Certificate
   */
  function buildLookupPackMap(csvText) {
    const rows = parseCsvRows(csvText);
    if (rows.length <= 1) return new Map();

    const header = rows[0].map((h) => h.toLowerCase().trim());
    const idxName = header.indexOf("trade goods for sale");
    const idxRegion = header.indexOf("trademark region");
    const idxCost = header.indexOf("cost");
    const idxPackingCost = header.indexOf("packing cost");
    const idxMat1 = header.indexOf("material 1");
    const idxQty = header.indexOf("quantity");
    const idxChest = header.findIndex((h) => h.startsWith("arcane sealed chest"));
    const idxCert = header.findIndex((h) => h.startsWith("blank trade certificate"));

    const toFlag = (val) => {
      const s = String(val ?? "").trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes" || s === "oui";
    };

    const toNum = (val, fallback = 0) => {
      if (val === undefined || val === null || String(val).trim() === "") return fallback;
      const cleaned = String(val).replace(/[^0-9.-]+/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : fallback;
    };

    const lookupMap = new Map();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const packName = (row[idxName] || "").trim();
      if (!packName) continue;

      const entry = {
        packName,
        trademarkRegion: idxRegion >= 0 ? (row[idxRegion] || "").trim() : "",
        cost: idxCost >= 0 ? toNum(row[idxCost], 0) : 0,
        packingCost: idxPackingCost >= 0 ? toNum(row[idxPackingCost], 0) : 0,
        material1: idxMat1 >= 0 ? (row[idxMat1] || "").trim() : "",
        quantity: idxQty >= 0 ? Math.max(1, toNum(row[idxQty], 1)) : 1,
        hasArcaneSealedChest: idxChest >= 0 ? toFlag(row[idxChest]) : false,
        hasBlankTradeCertificate: idxCert >= 0 ? toFlag(row[idxCert]) : false
      };

      lookupMap.set(normalizeItemKey(packName), entry);
    }

    return lookupMap;
  }

  /**
   * Calcule récursivement l'arbre de fabrication pour `neededQty` d'un item donné.
   */
  function calculateItemCraftTree(itemName, neededQty, recipesMap, visited = new Set()) {
    const key = normalizeItemKey(itemName);
    const safeQty = Math.max(0, Number(neededQty) || 0);
    const rawMaterials = new Map();
    const intermediateMaterials = new Map();

    let recipe = recipesMap ? recipesMap.get(key) : null;
    if (!recipe && recipesMap && typeof recipesMap.get === "function") {
      const altCanon = normalizeItemKey(canonicalPackKey(itemName));
      recipe = recipesMap.get(altCanon) || null;
    }

    if (!recipe || safeQty === 0) {
      if (safeQty > 0) {
        rawMaterials.set(key, { name: itemName, qty: safeQty });
      }
      return {
        itemName,
        neededQty: safeQty,
        craftRuns: 0,
        craftGoldCost: 0,
        isRaw: true,
        children: [],
        rawMaterials,
        intermediateMaterials
      };
    }

    if (visited.has(key)) {
      rawMaterials.set(key, { name: itemName, qty: safeQty });
      return {
        itemName,
        neededQty: safeQty,
        craftRuns: 0,
        craftGoldCost: 0,
        isRaw: true,
        cycleDetected: true,
        children: [],
        rawMaterials,
        intermediateMaterials
      };
    }

    const nextVisited = new Set(visited);
    nextVisited.add(key);

    const craftRuns = Math.ceil(safeQty / recipe.resultQty);
    let craftGoldCost = craftRuns * recipe.craftGold;

    intermediateMaterials.set(key, {
      name: recipe.resultItem || itemName,
      qty: safeQty
    });

    const children = [];

    for (const ing of recipe.ingredients) {
      const childNeededQty = ing.qty * craftRuns;
      const childResult = calculateItemCraftTree(
        ing.name,
        childNeededQty,
        recipesMap,
        nextVisited
      );

      children.push(childResult);
      craftGoldCost += childResult.craftGoldCost;

      for (const [rawKey, rawInfo] of childResult.rawMaterials.entries()) {
        const prev = rawMaterials.get(rawKey) || { name: rawInfo.name, qty: 0 };
        prev.qty += rawInfo.qty;
        rawMaterials.set(rawKey, prev);
      }

      for (const [midKey, midInfo] of childResult.intermediateMaterials.entries()) {
        const prev = intermediateMaterials.get(midKey) || { name: midInfo.name, qty: 0 };
        prev.qty += midInfo.qty;
        intermediateMaterials.set(midKey, prev);
      }
    }

    return {
      itemName: recipe.resultItem || itemName,
      neededQty: safeQty,
      resultQty: recipe.resultQty,
      unitCraftGold: recipe.craftGold,
      craftRuns,
      craftGoldCost,
      isRaw: false,
      children,
      rawMaterials,
      intermediateMaterials
    };
  }

  /**
   * Estime 1 pack à partir d'un objet normalisé (matériau principal + coûts + extras).
   */
  function estimateSinglePack(packSpec, recipesMap) {
    const {
      packName,
      materialName,
      materialQty = 1,
      packingGoldCost = 0,
      extraItems = []
    } = packSpec;

    const totalRaw = new Map();
    const totalIntermediate = new Map();
    const trees = [];
    let craftingGoldTotal = 0;

    const mergeMap = (targetMap, sourceMap) => {
      for (const [k, v] of sourceMap.entries()) {
        const existing = targetMap.get(k) || { name: v.name, qty: 0 };
        existing.qty += v.qty;
        targetMap.set(k, existing);
      }
    };

    if (materialName && materialQty > 0) {
      const mainTree = calculateItemCraftTree(materialName, materialQty, recipesMap);
      trees.push(mainTree);
      craftingGoldTotal += mainTree.craftGoldCost;
      mergeMap(totalRaw, mainTree.rawMaterials);
      mergeMap(totalIntermediate, mainTree.intermediateMaterials);
    }

    for (const extra of extraItems) {
      if (!extra || !extra.name || !(extra.qty > 0)) continue;
      const extraTree = calculateItemCraftTree(extra.name, extra.qty, recipesMap);
      trees.push(extraTree);
      craftingGoldTotal += extraTree.craftGoldCost;
      mergeMap(totalRaw, extraTree.rawMaterials);
      mergeMap(totalIntermediate, extraTree.intermediateMaterials);
    }

    const packGoldCost = Number(packingGoldCost) || 0;

    return {
      packName,
      trees,
      craftingGoldTotal,
      packingGoldCost: packGoldCost,
      totalGoldCost: craftingGoldTotal + packGoldCost,
      rawMaterials: Array.from(totalRaw.values()),
      intermediateMaterials: Array.from(totalIntermediate.values())
    };
  }

  /**
   * Estime 1 pack directement depuis une entrée Lookup + la map Craft/Recipes.
   */

  function canonicalPackKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/trade box$/i, "trade goods")
      .replace(/\s+/g, " ")
      .trim();
  }

  function resolveLookupEntry(packName, lookupMap) {
    if (!lookupMap || !packName) return null;
    const rawLower = String(packName).trim().toLowerCase();
    const normKey = normalizeItemKey(packName);
    const canonKey = canonicalPackKey(packName);
    const canonNormKey = normalizeItemKey(canonKey);

    let entry =
      lookupMap.get(rawLower) ||
      lookupMap.get(normKey) ||
      lookupMap.get(canonKey) ||
      lookupMap.get(canonNormKey) ||
      null;

    if (!entry && typeof lookupMap.values === "function") {
      for (const v of lookupMap.values()) {
        if (!v || typeof v !== "object") continue;
        const candidateName = v.packName || v.name || "";
        if (
          canonicalPackKey(candidateName) === canonKey ||
          normalizeItemKey(candidateName) === canonNormKey
        ) {
          entry = v;
          break;
        }
      }
    }

    if (!entry) return null;

    // Normalize both schema shapes:
    // Shape A (buildLookupPackMap): { packName, trademarkRegion, cost, packingCost, material1, quantity, hasArcaneSealedChest, hasBlankTradeCertificate }
    // Shape B (app.js parseLookupTable): { name, region, costGold, packingCostGold, buyPriceGold, materials: [{name, qty}, ...] }
    if (Array.isArray(entry.materials)) {
      let material1 = entry.material1 || "";
      let quantity = entry.quantity || 0;
      let hasArcaneSealedChest = Boolean(entry.hasArcaneSealedChest);
      let hasBlankTradeCertificate = Boolean(entry.hasBlankTradeCertificate);
      const extraMaterials = [];

      for (const m of entry.materials) {
        if (!m) continue;
        const mName = typeof m === "string" ? m : (m.name || "");
        const mQty = typeof m === "string" ? 1 : (Number(m.qty) || 1);
        const mLower = mName.toLowerCase().trim();
        if (mLower === "arcane sealed chest") {
          hasArcaneSealedChest = true;
        } else if (mLower === "blank trade certificate") {
          hasBlankTradeCertificate = true;
        } else if (!material1 && mName) {
          material1 = mName;
          quantity = mQty;
        } else if (mName) {
          extraMaterials.push({ name: mName, qty: mQty });
        }
      }

      const cost = entry.cost !== undefined ? Number(entry.cost) || 0 : (Number(entry.costGold) || 0);
      const packingCost = entry.packingCost !== undefined ? Number(entry.packingCost) || 0 : (Number(entry.packingCostGold) || 0);

      return {
        packName: entry.packName || entry.name || packName,
        trademarkRegion: entry.trademarkRegion || entry.region || "",
        cost,
        packingCost,
        material1,
        quantity: quantity || 1,
        hasArcaneSealedChest,
        hasBlankTradeCertificate,
        extraMaterials
      };
    }

    return {
      ...entry,
      extraMaterials: Array.isArray(entry.extraMaterials) ? entry.extraMaterials : []
    };
  }

  function estimatePackFromLookup(packName, lookupMap, recipesMap) {
    if (!lookupMap) return null;
    const entry = resolveLookupEntry(packName, lookupMap);
    if (!entry) return null;

    const extraItems = [];
    for (const em of entry.extraMaterials || []) {
      if (em && em.name && em.qty > 0) {
        extraItems.push({ name: em.name, qty: em.qty });
      }
    }
    if (entry.hasArcaneSealedChest) {
      extraItems.push({ name: "Arcane Sealed Chest", qty: 1 });
    }
    if (entry.hasBlankTradeCertificate) {
      extraItems.push({ name: "Blank Trade Certificate", qty: 1 });
    }

    const base = estimateSinglePack(
      {
        packName: entry.packName,
        materialName: entry.material1,
        materialQty: entry.quantity,
        packingGoldCost: (entry.cost || 0) + (entry.packingCost || 0),
        extraItems
      },
      recipesMap
    );

    return {
      ...base,
      trademarkRegion: entry.trademarkRegion,
      lookupCost: entry.cost,
      lookupPackingCost: entry.packingCost,
      hasArcaneSealedChest: entry.hasArcaneSealedChest,
      hasBlankTradeCertificate: entry.hasBlankTradeCertificate
    };
  }

  /**
   * Agrège l'estimation sur l'ensemble des slots d'une charrette (max 7 packs).
   */
  function estimateWagonCargo(packEstimates, maxSlots = DEFAULT_MAX_WAGON_SLOTS) {
    const activePacks = (packEstimates || []).filter(Boolean).slice(0, maxSlots);
    const cargoRaw = new Map();
    const cargoIntermediate = new Map();

    let totalCraftingGold = 0;
    let totalPackingGold = 0;
    let totalGoldCost = 0;

    for (const packEst of activePacks) {
      totalCraftingGold += packEst.craftingGoldTotal || 0;
      totalPackingGold += packEst.packingGoldCost || 0;
      totalGoldCost += packEst.totalGoldCost || 0;

      for (const item of packEst.rawMaterials || []) {
        const k = normalizeItemKey(item.name);
        const prev = cargoRaw.get(k) || { name: item.name, qty: 0 };
        prev.qty += item.qty;
        cargoRaw.set(k, prev);
      }

      for (const item of packEst.intermediateMaterials || []) {
        const k = normalizeItemKey(item.name);
        const prev = cargoIntermediate.get(k) || { name: item.name, qty: 0 };
        prev.qty += item.qty;
        cargoIntermediate.set(k, prev);
      }
    }

    return {
      packCount: activePacks.length,
      maxSlots,
      totalCraftingGold,
      totalPackingGold,
      totalGoldCost,
      rawMaterials: Array.from(cargoRaw.values()).sort((a, b) => b.qty - a.qty),
      intermediateMaterials: Array.from(cargoIntermediate.values()).sort(
        (a, b) => b.qty - a.qty
      )
    };
  }

  /**
   * Charge et parse Lookup + Craft/Recipes en parallèle depuis leurs URLs CSV.
   */
  async function loadCraftingData({ lookupCsvUrl, craftRecipesCsvUrl }) {
    const [lookupText, craftText] = await Promise.all([
      lookupCsvUrl ? fetch(lookupCsvUrl).then((r) => r.text()) : Promise.resolve(""),
      craftRecipesCsvUrl ? fetch(craftRecipesCsvUrl).then((r) => r.text()) : Promise.resolve("")
    ]);

    return {
      lookupMap: buildLookupPackMap(lookupText),
      recipesMap: buildCraftRecipeMap(craftText)
    };
  }

  // Exposition globale propre (sans polluer les fonctions existantes de app.js)
  global.CraftingEstimator = {
    MAX_WAGON_SLOTS: DEFAULT_MAX_WAGON_SLOTS,
    normalizeItemKey,
    parseCsvRows,
    buildCraftRecipeMap,
    buildLookupPackMap,
    calculateItemCraftTree,
    estimateSinglePack,
    estimatePackFromLookup,
    estimateWagonCargo,
    loadCraftingData
  };
})(window);
