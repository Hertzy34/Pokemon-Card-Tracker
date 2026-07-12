const STORAGE_KEY = "pokemonCollectionV1";

let collection = loadCollection();
let editingId = null;

function loadCollection() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through to seed */ }
  }
  return SEED_CARDS.map(c => ({ ...c }));
}

function saveCollection() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function money(n) {
  return "$" + (Math.round(n * 100) / 100).toFixed(2);
}

function setStatus(text) {
  document.getElementById("statusLine").textContent = text;
}

// ---------- Pokemon TCG API lookup ----------

const FOIL_KEY_MAP = {
  "Holofoil": "holofoil",
  "Reverse Holofoil": "reverseHolofoil",
  "Normal": "normal",
  "1st Edition Holofoil": "1stEditionHolofoil",
  "1st Edition Normal": "1stEdition",
  "Unlimited Holofoil": "unlimitedHolofoil",
};

async function apiQuery(name, set, numberFilter) {
  let q = `name:"${name.replace(/"/g, "")}" set.name:"${set.replace(/"/g, "")}"`;
  if (numberFilter) q += ` number:${numberFilter}`;
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data || [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCardPricing(card) {
  const numPart = (card.number || "").split("/")[0];
  const numTrimmed = numPart.replace(/^0+/, "") || numPart;

  let results = [];
  if (numTrimmed) results = await apiQuery(card.name, card.set, numTrimmed);
  if (!results.length) results = await apiQuery(card.name, card.set, null);
  if (!results.length) return null;

  const preferredKey = FOIL_KEY_MAP[card.foil];

  for (const c of results) {
    const prices = c.tcgplayer && c.tcgplayer.prices;
    if (!prices) continue;
    let market = null;
    if (preferredKey && prices[preferredKey] && typeof prices[preferredKey].market === "number") {
      market = prices[preferredKey].market;
    } else {
      const anyKey = Object.keys(prices).find(k => typeof prices[k].market === "number");
      if (anyKey) market = prices[anyKey].market;
    }
    if (market != null) {
      return {
        price: market,
        imageUrl: c.images && c.images.small,
      };
    }
  }
  return null;
}

async function refreshOne(card, { save = true, rerender = true } = {}) {
  try {
    const result = await fetchCardPricing(card);
    if (result) {
      card.price = result.price;
      card.priceSource = "api";
      card.lastUpdated = new Date().toISOString().slice(0, 10);
      if (result.imageUrl) card.imageUrl = result.imageUrl;
      if (save) saveCollection();
      if (rerender) render();
      return true;
    }
  } catch (e) {
    console.error("refresh failed for", card.name, e);
  }
  return false;
}

async function refreshAll() {
  const btn = document.getElementById("btnRefreshAll");
  btn.disabled = true;
  let matched = 0;
  let done = 0;
  const total = collection.length;
  const queue = collection.slice();
  const CONCURRENCY = 6;

  async function worker() {
    while (queue.length) {
      const card = queue.shift();
      const ok = await refreshOne(card, { save: false, rerender: false });
      if (ok) matched++;
      done++;
      setStatus(`Refreshing prices... ${done}/${total} (${matched} updated)`);
      if (done % 10 === 0) render();
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveCollection();
  render();
  setStatus(`Done. Updated ${matched}/${total} cards from live pricing.`);
  btn.disabled = false;
}

// ---------- Rendering ----------

function computeTotals(list) {
  const totalValue = list.reduce((sum, c) => sum + c.price * c.qty, 0);
  const totalQty = list.reduce((sum, c) => sum + c.qty, 0);
  return { totalValue, totalQty, uniqueCount: list.length };
}

function getFilteredSorted() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const sortBy = document.getElementById("sortSelect").value;

  let list = collection.filter(c =>
    !query || c.name.toLowerCase().includes(query) || c.set.toLowerCase().includes(query)
  );

  const sorters = {
    "value-desc": (a, b) => (b.price * b.qty) - (a.price * a.qty),
    "value-asc": (a, b) => (a.price * a.qty) - (b.price * b.qty),
    "name-asc": (a, b) => a.name.localeCompare(b.name),
    "set-asc": (a, b) => a.set.localeCompare(b.set),
    "updated-desc": (a, b) => (b.lastUpdated || "").localeCompare(a.lastUpdated || ""),
  };
  list = list.slice().sort(sorters[sortBy] || sorters["value-desc"]);
  return list;
}

function render() {
  const list = getFilteredSorted();
  const tbody = document.getElementById("cardTableBody");
  const emptyState = document.getElementById("emptyState");

  tbody.innerHTML = "";
  emptyState.classList.toggle("hidden", list.length > 0);

  for (const card of list) {
    const tr = document.createElement("tr");

    const imgHtml = card.imageUrl
      ? `<img class="card-img" src="${card.imageUrl}" alt="">`
      : `<div class="card-img"></div>`;

    tr.innerHTML = `
      <td>
        <div class="card-name-cell">
          ${imgHtml}
          <div>
            <div class="card-name">${escapeHtml(card.name)}</div>
            <div class="card-set">${escapeHtml(card.set)} &middot; #${escapeHtml(card.number)}</div>
          </div>
        </div>
      </td>
      <td>
        <div><span class="badge">${escapeHtml(card.rarity || "")}</span></div>
        <div style="margin-top:4px; color:var(--muted); font-size:12px;">${escapeHtml(card.condition || "")} &middot; ${escapeHtml(card.foil || "")}</div>
      </td>
      <td>
        <input type="number" class="price-input" step="0.01" min="0" value="${card.price}" data-id="${card.id}" data-field="price">
      </td>
      <td>
        <input type="number" class="qty-input" min="0" value="${card.qty}" data-id="${card.id}" data-field="qty">
      </td>
      <td class="subtotal">${money(card.price * card.qty)}</td>
      <td>
        <div style="font-size:12px;" class="source-${(card.priceSource||"manual")}">${card.lastUpdated || ""}</div>
        <div style="font-size:11px; color:var(--muted);">${labelForSource(card.priceSource)}</div>
      </td>
      <td>
        <div class="row-actions">
          <button data-action="refresh" data-id="${card.id}" title="Refresh this card's price">&#8635;</button>
          <button data-action="delete" data-id="${card.id}" class="danger-outline" title="Remove">&times;</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  const totals = computeTotals(collection);
  document.getElementById("statValue").textContent = money(totals.totalValue);
  document.getElementById("statQty").textContent = totals.totalQty;
  document.getElementById("statUnique").textContent = totals.uniqueCount;
}

function labelForSource(source) {
  if (source === "api") return "live price";
  if (source === "manual") return "manual entry";
  return "imported snapshot";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// ---------- Event wiring ----------

document.getElementById("searchInput").addEventListener("input", render);
document.getElementById("sortSelect").addEventListener("change", render);
document.getElementById("btnRefreshAll").addEventListener("click", refreshAll);

document.getElementById("cardTableBody").addEventListener("change", (e) => {
  const target = e.target;
  const id = target.dataset.id;
  if (!id) return;
  const card = collection.find(c => c.id === id);
  if (!card) return;

  if (target.dataset.field === "price") {
    card.price = parseFloat(target.value) || 0;
    card.priceSource = "manual";
    card.lastUpdated = new Date().toISOString().slice(0, 10);
  } else if (target.dataset.field === "qty") {
    card.qty = Math.max(0, parseInt(target.value) || 0);
  }
  saveCollection();
  render();
});

document.getElementById("cardTableBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const card = collection.find(c => c.id === id);
  if (!card) return;

  if (btn.dataset.action === "delete") {
    if (confirm(`Remove ${card.name} from your collection?`)) {
      collection = collection.filter(c => c.id !== id);
      saveCollection();
      render();
    }
  } else if (btn.dataset.action === "refresh") {
    btn.disabled = true;
    const ok = await refreshOne(card);
    setStatus(ok ? `Updated ${card.name}.` : `No live price found for ${card.name} — kept existing value.`);
    btn.disabled = false;
  }
});

// ---------- Add / Edit modal ----------

const modalBackdrop = document.getElementById("modalBackdrop");

function openAddModal() {
  editingId = null;
  document.getElementById("modalTitle").textContent = "Add Card";
  document.getElementById("fName").value = "";
  document.getElementById("fSet").value = "";
  document.getElementById("fNumber").value = "";
  document.getElementById("fRarity").value = "";
  document.getElementById("fCondition").value = "Near Mint";
  document.getElementById("fFoil").value = "Normal";
  document.getElementById("fQty").value = 1;
  document.getElementById("fPrice").value = 0;
  document.getElementById("lookupStatus").textContent = "";
  modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
}

document.getElementById("btnAddCard").addEventListener("click", openAddModal);
document.getElementById("btnCancelModal").addEventListener("click", closeModal);

document.getElementById("btnLookupPrice").addEventListener("click", async () => {
  const lookupStatus = document.getElementById("lookupStatus");
  const draft = {
    name: document.getElementById("fName").value.trim(),
    set: document.getElementById("fSet").value.trim(),
    number: document.getElementById("fNumber").value.trim(),
    foil: document.getElementById("fFoil").value,
  };
  if (!draft.name || !draft.set) {
    lookupStatus.textContent = "Enter a name and set first.";
    return;
  }
  lookupStatus.textContent = "Looking up...";
  const result = await fetchCardPricing(draft);
  if (result) {
    document.getElementById("fPrice").value = result.price;
    lookupStatus.textContent = `Found market price: ${money(result.price)}`;
  } else {
    lookupStatus.textContent = "No match found — enter price manually.";
  }
});

document.getElementById("btnSaveCard").addEventListener("click", () => {
  const name = document.getElementById("fName").value.trim();
  const set = document.getElementById("fSet").value.trim();
  if (!name || !set) {
    alert("Name and set are required.");
    return;
  }
  const card = {
    id: editingId || `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    set,
    number: document.getElementById("fNumber").value.trim(),
    rarity: document.getElementById("fRarity").value.trim(),
    condition: document.getElementById("fCondition").value,
    foil: document.getElementById("fFoil").value,
    qty: Math.max(1, parseInt(document.getElementById("fQty").value) || 1),
    price: parseFloat(document.getElementById("fPrice").value) || 0,
    priceSource: "manual",
    lastUpdated: new Date().toISOString().slice(0, 10),
    imageUrl: null,
  };
  collection.push(card);
  saveCollection();
  closeModal();
  render();
});

// ---------- CSV export ----------

document.getElementById("btnExportCsv").addEventListener("click", () => {
  const header = ["Name", "Set", "Number", "Rarity", "Condition", "Foil", "Qty", "Price", "Subtotal", "Source", "Last Updated"];
  const rows = collection.map(c => [
    c.name, c.set, c.number, c.rarity, c.condition, c.foil, c.qty, c.price.toFixed(2), (c.price * c.qty).toFixed(2), c.priceSource, c.lastUpdated
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pokemon-collection-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

render();
