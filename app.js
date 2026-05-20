/* ============================================================
 * TTI Cable & Infrastructure Benchmark — APP
 * ============================================================ */

const STATE = {
  selectedAssetId: null,
  pins: [null, null, null],
  activeLayers: new Set(LAYERS.filter(l => l.default).map(l => l.id)),
  view: "map",
  filters: { search: "", owner: "", type: "" },
  showCompare: false
};

const LAYER_BY_ID = Object.fromEntries(LAYERS.map(l => [l.id, l]));

function colorForAsset(a) {
  const l = LAYER_BY_ID[a.layer];
  return l ? l.color : "#7d8590";
}

function isCable(a) {
  return a.type === "subsea" || a.type === "terrestrial";
}

/* ============================================================
 * MAP
 * ============================================================ */
const map = L.map("map", {
  center: [38, 28], zoom: 3, minZoom: 2, maxZoom: 10,
  worldCopyJump: true, zoomControl: true
});

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: "abcd", maxZoom: 19
}).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", {
  subdomains: "abcd", maxZoom: 19, pane: "shadowPane"
}).addTo(map);

const layerGroups = {};
LAYERS.forEach(l => {
  layerGroups[l.id] = L.layerGroup();
  if (l.default) layerGroups[l.id].addTo(map);
});

function popupHTML(a) {
  if (isCable(a)) {
    const cap = a.capacity_tbps_design != null ? `${a.capacity_tbps_design} Tbps design` : "—";
    return `<div class="map-popup">
      <div class="pop-title">${a.name}</div>
      <div class="pop-meta">${a.owner || a.operator || ''} &middot; ${a.type} &middot; RFS ${a.rfs_date || "—"}</div>
      <div class="pop-meta" style="margin-top:4px;">${cap}</div>
    </div>`;
  }
  const meta = [a.operator, a.city, a.country].filter(Boolean).join(" · ");
  return `<div class="map-popup">
    <div class="pop-title">${a.name}</div>
    <div class="pop-meta">${meta}</div>
    ${a.notes ? `<div class="pop-meta" style="margin-top:4px;">${a.notes}</div>` : ''}
  </div>`;
}

function renderAssetOnMap(a) {
  const color = colorForAsset(a);
  const targetLayer = layerGroups[a.layer];
  if (!targetLayer) return;

  if (isCable(a) && a.geometry && a.geometry.length >= 2) {
    const line = L.polyline(a.geometry, {
      color,
      weight: a.ownerGroup === "tti" ? 3.2 : 2,
      opacity: a.ownerGroup === "tti" ? 0.95 : 0.75,
      dashArray: a.type === "terrestrial" ? "6,5" : null
    });
    line.bindPopup(popupHTML(a));
    line.on("click", (ev) => { L.DomEvent.stopPropagation(ev); selectAsset(a.id); });
    line.addTo(targetLayer);
    a._mapFeature = line;

    if (a.landings && a.landings.length) {
      a.landings.forEach(lg => {
        const m = L.circleMarker([lg.lat, lg.lng], {
          radius: 3.5, color, weight: 1.5, fillColor: "#001018", fillOpacity: 1
        });
        m.bindPopup(`<div class="map-popup"><div class="pop-title">${lg.name}</div><div class="pop-meta">${a.name} landing</div></div>`);
        m.addTo(targetLayer);
      });
    }
  } else if (a.lat != null && a.lng != null) {
    let radius = 4, fillOpacity = 0.85;
    if (a.layer === "ai-megasite") {
      radius = 5 + Math.sqrt((a.planned_mw || 100) / 200);
      fillOpacity = 0.7;
    } else if (a.layer === "ixp") {
      radius = 4 + Math.sqrt((a.peak_tbps || 1));
    } else if (a.layer === "tti-pop" && a.tier === "primary") {
      radius = 5.5;
    }
    const m = L.circleMarker([a.lat, a.lng], {
      radius, color, weight: 1.5, fillColor: color, fillOpacity
    });
    m.bindPopup(popupHTML(a));
    m.on("click", () => selectAsset(a.id));
    m.addTo(targetLayer);
    a._mapFeature = m;
  }
}

ASSETS.forEach(renderAssetOnMap);

/* ============================================================
 * LAYER TOGGLES
 * ============================================================ */
const layerTogglesEl = document.getElementById("layer-toggles");
LAYERS.forEach(l => {
  const count = ASSETS.filter(a => a.layer === l.id).length;
  const row = document.createElement("label");
  row.className = "layer-toggle";
  const swClass = l.kind === "dot" ? "swatch dot" : "swatch";
  row.innerHTML = `
    <input type="checkbox" ${l.default ? "checked" : ""} data-layer="${l.id}" />
    <span class="${swClass}" style="background:${l.color}"></span>
    <span class="label">${l.label}</span>
    <span class="count">${count}</span>
  `;
  layerTogglesEl.appendChild(row);
});
layerTogglesEl.addEventListener("change", (ev) => {
  if (!ev.target.matches('input[type="checkbox"]')) return;
  const id = ev.target.dataset.layer;
  if (ev.target.checked) {
    STATE.activeLayers.add(id);
    layerGroups[id].addTo(map);
  } else {
    STATE.activeLayers.delete(id);
    map.removeLayer(layerGroups[id]);
  }
  renderStats();
});
document.getElementById("layer-all").addEventListener("click", () => {
  const allOn = LAYERS.every(l => STATE.activeLayers.has(l.id));
  LAYERS.forEach(l => {
    const cb = layerTogglesEl.querySelector(`input[data-layer="${l.id}"]`);
    if (allOn) {
      STATE.activeLayers.delete(l.id);
      if (cb) cb.checked = false;
      map.removeLayer(layerGroups[l.id]);
    } else {
      STATE.activeLayers.add(l.id);
      if (cb) cb.checked = true;
      layerGroups[l.id].addTo(map);
    }
  });
  renderStats();
});

/* ============================================================
 * SIDEBAR LIST + FILTERS
 * ============================================================ */
const assetListEl = document.getElementById("asset-list");
const assetCountEl = document.getElementById("asset-count");
const filterSearch = document.getElementById("filter-search");
const filterOwner = document.getElementById("filter-owner");
const filterType = document.getElementById("filter-type");

const owners = [...new Set(ASSETS.map(a => a.owner || a.operator).filter(Boolean))].sort();
owners.forEach(o => {
  const opt = document.createElement("option");
  opt.value = o; opt.textContent = o;
  filterOwner.appendChild(opt);
});

function passesFilters(a) {
  const q = STATE.filters.search.toLowerCase();
  if (q) {
    const hay = [a.name, a.owner, a.operator, a.city, a.country, a.notes].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (STATE.filters.owner && (a.owner || a.operator) !== STATE.filters.owner) return false;
  if (STATE.filters.type && a.type !== STATE.filters.type) return false;
  return true;
}

function renderAssetList() {
  const filtered = ASSETS.filter(passesFilters);
  assetListEl.innerHTML = "";
  filtered.forEach(a => {
    const el = document.createElement("div");
    el.className = "asset-item" + (a.id === STATE.selectedAssetId ? " selected" : "");
    el.dataset.id = a.id;
    el.innerHTML = `
      <span class="dot" style="background:${colorForAsset(a)}"></span>
      <span class="name" title="${a.name}">${a.name}</span>
      <span class="type">${a.type}</span>
    `;
    el.addEventListener("click", () => selectAsset(a.id, true));
    assetListEl.appendChild(el);
  });
  assetCountEl.textContent = `(${filtered.length} / ${ASSETS.length})`;
}
filterSearch.addEventListener("input", e => { STATE.filters.search = e.target.value; renderAssetList(); });
filterOwner.addEventListener("change", e => { STATE.filters.owner = e.target.value; renderAssetList(); });
filterType.addEventListener("change", e => { STATE.filters.type = e.target.value; renderAssetList(); });
renderAssetList();

/* ============================================================
 * DETAIL PANE
 * ============================================================ */
const detailPane = document.getElementById("asset-detail-pane");

function fmt(v, unit) {
  if (v == null || v === "") return `<span style="color:var(--text-mute)">—</span>`;
  return `${v}${unit ? `<span class="u">${unit}</span>` : ""}`;
}
function estBadge(a, field) {
  return a[field + "_est"] ? ` <span class="badge est">est</span>` : "";
}

function selectAsset(id, fly = false) {
  STATE.selectedAssetId = id;
  const a = ASSETS.find(x => x.id === id);
  if (!a) return;
  detailPane.innerHTML = renderDetailHTML(a);
  wireDetailPaneEvents(a);
  renderAssetList();

  if (fly) {
    if (isCable(a) && a.geometry && a.geometry.length) {
      map.fitBounds(L.latLngBounds(a.geometry).pad(0.2), { maxZoom: 5 });
    } else if (a.lat != null && a.lng != null) {
      map.setView([a.lat, a.lng], Math.max(map.getZoom(), 6));
    }
  }
}

function renderDetailHTML(a) {
  const isPinned = STATE.pins.includes(a.id);
  const cable = isCable(a);
  const lk = a.latency_ms_key_pair;

  let kpiBlock = "";
  if (cable) {
    kpiBlock = `
      <div class="kpi-grid">
        <div class="kpi"><div class="k">Capacity (design)${estBadge(a,'capacity_tbps_design')}</div><div class="v">${fmt(a.capacity_tbps_design,' Tbps')}</div></div>
        <div class="kpi"><div class="k">Capacity (lit)${estBadge(a,'capacity_tbps_lit')}</div><div class="v">${fmt(a.capacity_tbps_lit,' Tbps')}</div></div>
        <div class="kpi"><div class="k">CapEx${estBadge(a,'capex_usd_m')}</div><div class="v">${fmt(a.capex_usd_m,' M$')}</div></div>
        <div class="kpi"><div class="k">OpEx / yr${estBadge(a,'opex_annual_usd_m')}</div><div class="v">${fmt(a.opex_annual_usd_m,' M$')}</div></div>
        <div class="kpi"><div class="k">Revenue pot.${estBadge(a,'revenue_potential_usd_m')}</div><div class="v">${fmt(a.revenue_potential_usd_m,' M$')}</div></div>
        <div class="kpi"><div class="k">Strategic Value</div><div class="v">${fmt(a.strategic_value_score,' /10')}</div></div>
        <div class="kpi"><div class="k">Diversity</div><div class="v">${fmt(a.route_diversity_score,' /10')}</div></div>
        <div class="kpi"><div class="k">Segments owned${estBadge(a,'segments_owned_pct')}</div><div class="v">${fmt(a.segments_owned_pct,'%')}</div></div>
      </div>`;
  } else if (a.layer === "ai-megasite") {
    kpiBlock = `
      <div class="kpi-grid">
        <div class="kpi"><div class="k">Planned MW</div><div class="v">${fmt(a.planned_mw,' MW')}</div></div>
        <div class="kpi"><div class="k">Current MW</div><div class="v">${fmt(a.current_mw,' MW')}</div></div>
        <div class="kpi"><div class="k">GPU count</div><div class="v">${a.gpu_count ? a.gpu_count.toLocaleString() : '<span style="color:var(--text-mute)">—</span>'}</div></div>
        <div class="kpi"><div class="k">RFS</div><div class="v">${fmt(a.rfs_date)}</div></div>
      </div>`;
  } else if (a.layer === "ixp") {
    kpiBlock = `
      <div class="kpi-grid">
        <div class="kpi"><div class="k">Peak traffic</div><div class="v">${fmt(a.peak_tbps,' Tbps')}</div></div>
        <div class="kpi"><div class="k">Members</div><div class="v">${fmt(a.members)}</div></div>
      </div>`;
  } else if (a.layer.startsWith("hs-region")) {
    kpiBlock = `
      <div class="kpi-grid">
        <div class="kpi"><div class="k">Opened</div><div class="v">${fmt(a.opened)}</div></div>
        <div class="kpi"><div class="k">Provider</div><div class="v" style="font-size:11px;">${a.operator}</div></div>
      </div>`;
  } else {
    kpiBlock = `
      <div class="kpi-grid">
        <div class="kpi"><div class="k">City</div><div class="v" style="font-size:12px;">${fmt(a.city)}</div></div>
        <div class="kpi"><div class="k">Country</div><div class="v">${fmt(a.country)}</div></div>
      </div>`;
  }

  let detailRows = "";
  if (cable) {
    detailRows = `
      <div class="detail-row"><span class="k">RFS</span><span class="v">${a.rfs_date || "—"}</span></div>
      <div class="detail-row"><span class="k">Status</span><span class="v">${a.status || "—"}</span></div>
      ${lk ? `<div class="detail-row"><span class="k">Latency: ${lk.pair}</span><span class="v">${lk.value} ms${lk.est ? ' <span class="badge est">est</span>' : ''}</span></div>` : ''}
      <div class="detail-row"><span class="k">IRUs sold${estBadge(a,'irus_sold')}</span><span class="v">${fmt(a.irus_sold)}</span></div>
      <div class="detail-row"><span class="k">Partners</span><span class="v" style="text-align:right; max-width:60%;">${(a.partners||[]).join(", ") || "—"}</span></div>
      <div class="detail-row"><span class="k">Landings</span><span class="v" style="text-align:right; max-width:60%;">${(a.landings||[]).map(l=>l.name).join(" · ") || "—"}</span></div>`;
  } else {
    detailRows = `
      <div class="detail-row"><span class="k">Tier</span><span class="v">${a.tier || "—"}</span></div>
      ${a.opened ? `<div class="detail-row"><span class="k">Opened</span><span class="v">${a.opened}</span></div>` : ''}
      ${a.status ? `<div class="detail-row"><span class="k">Status</span><span class="v">${a.status}</span></div>` : ''}
      <div class="detail-row"><span class="k">Coordinates</span><span class="v">${a.lat?.toFixed(3)}, ${a.lng?.toFixed(3)}</span></div>`;
  }

  const ownerLabel = a.owner || a.operator || "—";
  return `
    <div class="asset-detail">
      <h2>${a.name}</h2>
      <div class="subtitle">
        <span class="badge ${a.ownerGroup === 'tti' ? 'tti' : ''}">${a.type}</span>
        <span>${ownerLabel}</span>
      </div>
      ${kpiBlock}
      ${detailRows}
      ${a.notes ? `<p style="margin-top:14px; font-size:12px; color:var(--text-dim); line-height:1.55;">${a.notes}</p>` : ""}
      <div style="margin-top:14px; display:flex; gap:8px;">
        <button class="pin-btn ${isPinned ? 'active' : ''}" id="pin-asset">${isPinned ? '★ Pinned' : '☆ Pin to comparison'}</button>
        <button class="action-btn" id="zoom-asset">Zoom</button>
      </div>
    </div>`;
}

function wireDetailPaneEvents(a) {
  const pinBtn = document.getElementById("pin-asset");
  const zoomBtn = document.getElementById("zoom-asset");
  if (pinBtn) pinBtn.addEventListener("click", () => togglePin(a.id));
  if (zoomBtn) zoomBtn.addEventListener("click", () => {
    if (isCable(a) && a.geometry && a.geometry.length) {
      map.fitBounds(L.latLngBounds(a.geometry).pad(0.2), { maxZoom: 5 });
    } else if (a.lat != null) {
      map.setView([a.lat, a.lng], 7);
    }
  });
}

/* ============================================================
 * COMPARISON PINS
 * ============================================================ */
const pinSlotsEl = document.getElementById("pin-slots");
const compareTableHost = document.getElementById("compare-table-host");

function togglePin(id) {
  const existingIdx = STATE.pins.indexOf(id);
  if (existingIdx >= 0) {
    STATE.pins[existingIdx] = null;
  } else {
    const slot = STATE.pins.indexOf(null);
    if (slot < 0) { alert("Max 3 pins. Remove one first."); return; }
    STATE.pins[slot] = id;
  }
  renderPins();
  if (STATE.showCompare) renderCompareTable();
  if (STATE.selectedAssetId) selectAsset(STATE.selectedAssetId);
}

function renderPins() {
  pinSlotsEl.innerHTML = "";
  STATE.pins.forEach((pid, idx) => {
    const slot = document.createElement("div");
    slot.className = "pin-slot" + (pid ? " filled" : "");
    if (pid) {
      const a = ASSETS.find(x => x.id === pid);
      slot.innerHTML = `<span class="x" data-remove="${idx}">×</span>
        <div class="pin-name">${a.name}</div>
        <div class="pin-owner">${(a.owner || a.operator || "").split(' ')[0]}</div>`;
    } else {
      slot.textContent = "empty";
    }
    pinSlotsEl.appendChild(slot);
  });
}
pinSlotsEl.addEventListener("click", (ev) => {
  const rm = ev.target.dataset.remove;
  if (rm != null) {
    STATE.pins[parseInt(rm, 10)] = null;
    renderPins();
    if (STATE.showCompare) renderCompareTable();
    if (STATE.selectedAssetId) selectAsset(STATE.selectedAssetId);
  }
});

function renderCompareTable() {
  const pinned = STATE.pins.filter(Boolean).map(id => ASSETS.find(a => a.id === id));
  if (!pinned.length) { compareTableHost.innerHTML = ""; return; }
  const cableLike = pinned.every(isCable);
  let rows;
  if (cableLike) {
    rows = [
      ["Type", a => a.type],
      ["RFS", a => a.rfs_date],
      ["Cap. design", a => a.capacity_tbps_design, "Tbps"],
      ["Cap. lit", a => a.capacity_tbps_lit, "Tbps"],
      ["CapEx", a => a.capex_usd_m, "M$"],
      ["OpEx/yr", a => a.opex_annual_usd_m, "M$"],
      ["Rev. pot.", a => a.revenue_potential_usd_m, "M$"],
      ["Strategic", a => a.strategic_value_score, "/10"],
      ["Diversity", a => a.route_diversity_score, "/10"],
      ["Segments owned", a => a.segments_owned_pct, "%"]
    ];
  } else {
    rows = [
      ["Type", a => a.type],
      ["Operator", a => a.operator || a.owner],
      ["City", a => a.city],
      ["Country", a => a.country],
      ["Opened/RFS", a => a.opened || a.rfs_date],
      ["MW (planned)", a => a.planned_mw],
      ["GPU count", a => a.gpu_count ? a.gpu_count.toLocaleString() : null],
      ["Peak Tbps", a => a.peak_tbps],
      ["Members", a => a.members]
    ];
  }
  const html = `
    <div style="margin-top:14px;">
      <h4 style="margin:0 0 6px 0; font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--text-mute);">Comparison</h4>
      <table class="compare-table">
        <thead><tr><th></th>${pinned.map(a => `<th>${a.name.split(' ')[0]}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map(([label, f, unit]) => `
            <tr>
              <td class="label">${label}</td>
              ${pinned.map(a => {
                const v = f(a);
                return `<td>${v == null || v === "" ? "—" : v}${unit && v != null ? ` ${unit}` : ""}</td>`;
              }).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  compareTableHost.innerHTML = html;
}

document.getElementById("show-compare").addEventListener("click", () => {
  STATE.showCompare = !STATE.showCompare;
  if (STATE.showCompare) renderCompareTable();
  else compareTableHost.innerHTML = "";
});

document.getElementById("export-comparison").addEventListener("click", () => {
  const pinned = STATE.pins.filter(Boolean).map(id => ASSETS.find(a => a.id === id));
  if (!pinned.length) { alert("No pins to export."); return; }
  const blob = new Blob([JSON.stringify(pinned, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "tti-comparison.json"; a.click();
  URL.revokeObjectURL(url);
});

renderPins();

/* ============================================================
 * VIEW SWITCHER
 * ============================================================ */
const viewSwitchEl = document.getElementById("view-switch");
const contentEl = document.getElementById("content");
const tableViewEl = document.getElementById("table-view");
const matrixViewEl = document.getElementById("matrix-view");
const mapEl = document.getElementById("map");
const legendEl = document.getElementById("legend");
const statsEl = document.getElementById("stats");

viewSwitchEl.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-view]");
  if (!btn) return;
  [...viewSwitchEl.querySelectorAll("button")].forEach(b => b.classList.toggle("active", b === btn));
  STATE.view = btn.dataset.view;
  setView(STATE.view);
});

function setView(v) {
  mapEl.style.display = v === "map" ? "block" : "none";
  legendEl.style.display = v === "map" ? "block" : "none";
  statsEl.style.display = v === "map" ? "block" : "none";
  tableViewEl.style.display = v === "table" ? "block" : "none";
  matrixViewEl.style.display = v === "matrix" ? "block" : "none";
  if (v === "table") renderTableView();
  if (v === "matrix") renderMatrixView();
  if (v === "map") setTimeout(() => map.invalidateSize(), 50);
}

/* ============================================================
 * TABLE VIEW
 * ============================================================ */
let tableSort = { key: "name", dir: 1 };
function renderTableView() {
  const cableAssets = ASSETS.filter(isCable);
  const cols = [
    { k:"name", label:"Asset" },
    { k:"owner", label:"Owner" },
    { k:"type", label:"Type" },
    { k:"rfs_date", label:"RFS" },
    { k:"capacity_tbps_design", label:"Cap design (Tbps)", num:true, heat:true },
    { k:"capacity_tbps_lit", label:"Cap lit (Tbps)", num:true },
    { k:"capex_usd_m", label:"CapEx (M$)", num:true, heat:true },
    { k:"opex_annual_usd_m", label:"OpEx/yr (M$)", num:true },
    { k:"revenue_potential_usd_m", label:"Rev pot (M$)", num:true, heat:true },
    { k:"strategic_value_score", label:"Strat", num:true, heat:true },
    { k:"route_diversity_score", label:"Div", num:true },
    { k:"segments_owned_pct", label:"Own %", num:true }
  ];
  const rows = [...cableAssets].sort((a,b) => {
    const av = a[tableSort.key], bv = b[tableSort.key];
    if (av == null) return 1; if (bv == null) return -1;
    if (typeof av === "number") return (av - bv) * tableSort.dir;
    return String(av).localeCompare(String(bv)) * tableSort.dir;
  });
  const maxBy = {};
  cols.filter(c => c.heat).forEach(c => { maxBy[c.k] = Math.max(...cableAssets.map(a => a[c.k] || 0)); });

  tableViewEl.innerHTML = `
    <div class="view-toolbar">
      <h2>Benchmark Table</h2>
      <span style="color:var(--text-mute); font-size:11px;">${rows.length} cables (TTI rows highlighted)</span>
      <div style="flex:1"></div>
      <button class="action-btn" id="csv-export">Export CSV</button>
    </div>
    <table class="benchmark">
      <thead><tr>${cols.map(c => `<th data-sort="${c.k}">${c.label}${tableSort.key===c.k ? (tableSort.dir>0?' ▲':' ▼') : ''}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map(a => `<tr class="${a.ownerGroup==='tti'?'tti-row':''}">${cols.map(c => {
          let v = a[c.k];
          if (c.heat && v != null && maxBy[c.k]) {
            const ratio = v / maxBy[c.k];
            const isTti = a.ownerGroup === 'tti';
            const bg = isTti ? `rgba(0,200,230,${0.15 + ratio*0.45})` : `rgba(245,158,11,${0.08 + ratio*0.35})`;
            return `<td class="${c.k==='name'?'name':''}"><span class="heat" style="background:${bg}">${v}</span></td>`;
          }
          return `<td class="${c.k==='name'?'name':''}">${v == null ? '—' : v}</td>`;
        }).join("")}</tr>`).join("")}
      </tbody>
    </table>`;
  tableViewEl.querySelectorAll("th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (tableSort.key === k) tableSort.dir *= -1;
      else { tableSort.key = k; tableSort.dir = 1; }
      renderTableView();
    });
  });
  document.getElementById("csv-export").addEventListener("click", exportCSV);
}

function exportCSV() {
  const cols = ["id","name","owner","operator","layer","type","rfs_date","status","capacity_tbps_design","capacity_tbps_lit","capex_usd_m","opex_annual_usd_m","revenue_potential_usd_m","strategic_value_score","route_diversity_score","segments_owned_pct","irus_sold","city","country","lat","lng","planned_mw","current_mw","gpu_count","peak_tbps","members","opened"];
  const head = cols.join(",");
  const lines = ASSETS.map(a => cols.map(c => {
    const v = a[c]; if (v == null) return "";
    const s = String(v).replace(/"/g,'""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  }).join(","));
  const blob = new Blob([head + "\n" + lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "tti-benchmark.csv"; a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
 * MATRIX VIEW
 * ============================================================ */
function renderMatrixView() {
  const matrices = [
    { title:"Capacity vs CapEx (cables)", x:"capex_usd_m", y:"capacity_tbps_design", xLabel:"CapEx (M$)", yLabel:"Capacity design (Tbps)", filter:isCable },
    { title:"Strategic Value vs Revenue", x:"revenue_potential_usd_m", y:"strategic_value_score", xLabel:"Revenue pot. (M$)", yLabel:"Strategic value /10", filter:isCable },
    { title:"RFS Year vs Capacity", x:"rfs_year", y:"capacity_tbps_design", xLabel:"RFS year", yLabel:"Capacity design (Tbps)", filter:isCable },
    { title:"AI Mega-DC: Planned MW", x:"current_mw", y:"planned_mw", xLabel:"Current MW", yLabel:"Planned MW", filter:a => a.layer === "ai-megasite" }
  ];
  matrixViewEl.innerHTML = `
    <div class="view-toolbar"><h2>Strategic Matrices</h2>
      <span style="color:var(--text-mute); font-size:11px;">Bubble size = scale · color = owner/layer</span>
    </div>
    <div class="matrix-grid">
      ${matrices.map((m,i) => `<div class="matrix-card"><h3>${m.title}</h3><div id="matrix-${i}"></div></div>`).join("")}
    </div>`;
  matrices.forEach((m, i) => {
    document.getElementById("matrix-" + i).innerHTML = scatterSVG(m);
  });
}

function scatterSVG(cfg) {
  const W = 480, H = 280, P = 40;
  const pool = ASSETS.filter(cfg.filter || (() => true));
  const pts = pool.map(a => {
    const xv = cfg.x === "rfs_year" ? (a.rfs_date ? parseInt(a.rfs_date, 10) : null) : a[cfg.x];
    const yv = a[cfg.y];
    return xv != null && yv != null ? { a, x: xv, y: yv } : null;
  }).filter(Boolean);
  if (!pts.length) return `<div style="color:var(--text-mute); padding:20px; text-align:center;">No data</div>`;

  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const xR = xmax - xmin || 1, yR = ymax - ymin || 1;
  const sx = v => P + (v - xmin) / xR * (W - 2*P);
  const sy = v => H - P - (v - ymin) / yR * (H - 2*P);
  const capMax = Math.max(...pool.map(a => a.capex_usd_m || a.planned_mw || 0), 1);
  const sr = a => 4 + Math.sqrt(((a.capex_usd_m || a.planned_mw || 1)) / capMax) * 14;

  return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
      <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="#233042"/>
      <line x1="${P}" y1="${P}" x2="${P}" y2="${H-P}" stroke="#233042"/>
      <text x="${W/2}" y="${H-8}" fill="#9aa4b2" font-size="10" text-anchor="middle">${cfg.xLabel}</text>
      <text x="14" y="${H/2}" fill="#9aa4b2" font-size="10" text-anchor="middle" transform="rotate(-90 14 ${H/2})">${cfg.yLabel}</text>
      ${pts.map(p => {
        const c = colorForAsset(p.a);
        return `<g>
          <circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${sr(p.a)}" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-width="1.5">
            <title>${p.a.name} — ${cfg.xLabel}: ${p.x} · ${cfg.yLabel}: ${p.y}</title>
          </circle>
          <text x="${sx(p.x) + sr(p.a) + 4}" y="${sy(p.y) + 3}" fill="#e6edf3" font-size="9" font-family="ui-monospace,monospace">${p.a.name.length > 22 ? p.a.name.slice(0,20)+'…' : p.a.name}</text>
        </g>`;
      }).join("")}
    </svg>`;
}

/* ============================================================
 * LEGEND + STATS
 * ============================================================ */
function renderLegend() {
  legendEl.innerHTML = `
    <h4>Legend</h4>
    ${LAYERS.map(l => `
      <div class="legend-row">
        <span class="${l.kind==='dot'?'swatch dot':'swatch'}" style="background:${l.color}"></span>
        <span>${l.label}</span>
      </div>`).join("")}
    <div style="margin-top:6px; border-top:1px solid var(--border); padding-top:6px; font-family:var(--mono); font-size:9px; color:var(--text-mute);">
      solid = subsea · dashed = terrestrial<br/>
      ai-dc bubble = √(MW) · ixp bubble = √(Tbps)
    </div>`;
}
renderLegend();

function renderStats() {
  const visible = ASSETS.filter(a => STATE.activeLayers.has(a.layer));
  const cables = visible.filter(isCable);
  const ttiCables = cables.filter(a => a.ownerGroup === "tti");
  const totalCapDesign = cables.reduce((s,a) => s + (a.capacity_tbps_design || 0), 0);
  const ttiCapDesign = ttiCables.reduce((s,a) => s + (a.capacity_tbps_design || 0), 0);
  const aiSites = visible.filter(a => a.layer === "ai-megasite");
  const aiMW = aiSites.reduce((s,a) => s + (a.planned_mw || 0), 0);
  const pops = visible.filter(a => a.layer === "tti-pop").length;

  statsEl.innerHTML = `
    <h4>Live Stats</h4>
    <div class="stat-row"><span class="k">Visible assets</span><span class="v">${visible.length}</span></div>
    <div class="stat-row"><span class="k">Cables</span><span class="v">${cables.length} <span style="color:var(--accent)">(TTI: ${ttiCables.length})</span></span></div>
    <div class="stat-row"><span class="k">Σ design cap.</span><span class="v">${totalCapDesign.toFixed(0)} Tbps</span></div>
    <div class="stat-row"><span class="k">TTI cap. share</span><span class="v">${totalCapDesign ? ((ttiCapDesign/totalCapDesign)*100).toFixed(1) : 0}%</span></div>
    <div class="stat-row"><span class="k">AI DC capacity</span><span class="v">${aiMW.toLocaleString()} MW</span></div>
    <div class="stat-row"><span class="k">TTI POPs</span><span class="v">${pops}</span></div>`;
}
renderStats();

document.getElementById("topbar-counts").textContent =
  `${ASSETS.length} assets · ${ASSETS.filter(isCable).length} cables · ${ASSETS.filter(a => a.layer==='tti-pop').length} TTI POPs · ${ASSETS.filter(a => a.layer==='ai-megasite').length} AI DCs`;

setView("map");
