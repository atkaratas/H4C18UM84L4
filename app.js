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
const trendsViewEl = document.getElementById("trends-view");
const strategyViewEl = document.getElementById("strategy-view");
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
  trendsViewEl.style.display = v === "trends" ? "block" : "none";
  strategyViewEl.style.display = v === "strategy" ? "block" : "none";
  if (v === "table") renderTableView();
  if (v === "matrix") renderMatrixView();
  if (v === "trends") renderTrendsView();
  if (v === "strategy") renderStrategyView();
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
 * TRENDS VIEW (TeleGeography 2026 time series)
 * ============================================================ */
const TRENDS = {
  // Subsea CapEx by year, USD billions (TG2026 Fig 5, with 2025-27 forecast)
  subseaCapex: [
    {y:2016, v:1.2},{y:2017, v:1.4},{y:2018, v:2.1},{y:2019, v:2.8},{y:2020, v:1.8},
    {y:2021, v:2.4},{y:2022, v:3.1},{y:2023, v:2.9},{y:2024, v:3.4},
    {y:2025, v:4.6, planned:true},{y:2026, v:5.2, planned:true},{y:2027, v:4.5, planned:true}
  ],
  // International bandwidth demand growth YoY, % (TG2026)
  bandwidthDemand: [
    {y:2020, africa:48, mideast:38, asia:42, europe:40, americas:38},
    {y:2021, africa:44, mideast:36, asia:38, europe:35, americas:32},
    {y:2022, africa:42, mideast:32, asia:34, europe:32, americas:30},
    {y:2023, africa:41, mideast:30, asia:32, europe:30, americas:28},
    {y:2024, africa:40, mideast:27, asia:30, europe:28, americas:25}
  ],
  // 100G wavelength price erosion CAGR by route (TG2026)
  wavelengthPrices: [
    {route:"Miami–São Paulo", q2021:23.5, q2024:12.0, cagr:-25},
    {route:"JNB–London",       q2021:52.0, q2024:32.3, cagr:-15},
    {route:"London–NY",        q2021:8.0,  q2024:5.5,  cagr:-12},
    {route:"Singapore–Tokyo",  q2021:18.0, q2024:15.0, cagr:-6},
    {route:"Marseille–Singapore", q2021:21.0, q2024:19.8, cagr:-2}
  ],
  // AI mega-DC cumulative MW online by year (from our dataset + announced)
  aiCapacity: [
    {y:2023, online:0, planned:250},
    {y:2024, online:250, planned:700},
    {y:2025, online:1850, planned:3500},
    {y:2026, online:5000, planned:9000},
    {y:2027, online:11000, planned:18000},
    {y:2028, online:18000, planned:25000}
  ],
  // New cloud regions launched (TG2026)
  cloudRegions: [
    {y:2017, n:9},{y:2018, n:18},{y:2019, n:45},{y:2020, n:23},{y:2021, n:27},
    {y:2022, n:23},{y:2023, n:26},{y:2024, n:13},{y:2025, n:18, planned:true}
  ]
};

function lineChart({data, xKey, series, W=440, H=200, P=36, yLabel="", colors}) {
  if (!data.length) return "";
  const xs = data.map(d => d[xKey]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const allYs = data.flatMap(d => series.map(s => d[s] || 0));
  const ymax = Math.max(...allYs) * 1.08 || 1;
  const sx = v => P + (v - xmin) / (xmax - xmin || 1) * (W - 2*P);
  const sy = v => H - P - (v / ymax) * (H - 2*P);
  const paths = series.map((s, i) => {
    const c = colors ? colors[i] : ["#00c8e6","#f59e0b","#ec4899","#84cc16","#a78bfa"][i % 5];
    const d = data.map((row, idx) => `${idx?'L':'M'}${sx(row[xKey]).toFixed(1)},${sy(row[s]||0).toFixed(1)}`).join(" ");
    const dots = data.map(row => `<circle cx="${sx(row[xKey])}" cy="${sy(row[s]||0)}" r="3" fill="${c}"/>`).join("");
    return `<path d="${d}" stroke="${c}" stroke-width="2" fill="none"/>${dots}`;
  }).join("");
  const xTicks = xs.map(x => `<text x="${sx(x)}" y="${H-12}" fill="#9aa4b2" font-size="9" text-anchor="middle">${x}</text>`).join("");
  const yTicks = [0, ymax/2, ymax].map(v => `<text x="${P-6}" y="${sy(v)+3}" fill="#9aa4b2" font-size="9" text-anchor="end">${v.toFixed(v<10?1:0)}</text><line x1="${P}" y1="${sy(v)}" x2="${W-P}" y2="${sy(v)}" stroke="#233042" stroke-dasharray="2,3"/>`).join("");
  const legend = series.map((s, i) => {
    const c = colors ? colors[i] : ["#00c8e6","#f59e0b","#ec4899","#84cc16","#a78bfa"][i % 5];
    return `<g transform="translate(${P + i*86}, ${P-22})"><rect width="10" height="3" fill="${c}"/><text x="14" y="4" fill="#e6edf3" font-size="9">${s}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${yTicks}${xTicks}${paths}${legend}
    <text x="14" y="${H/2}" fill="#9aa4b2" font-size="9" text-anchor="middle" transform="rotate(-90 14 ${H/2})">${yLabel}</text>
  </svg>`;
}

function barChart({data, xKey, yKey, plannedKey="planned", W=440, H=200, P=36, yLabel=""}) {
  const xs = data.map(d => d[xKey]);
  const ys = data.map(d => d[yKey]);
  const ymax = Math.max(...ys) * 1.1;
  const bw = (W - 2*P) / data.length * 0.7;
  const sx = i => P + i * (W - 2*P) / data.length + (W - 2*P) / data.length * 0.15;
  const sy = v => H - P - (v / ymax) * (H - 2*P);
  const bars = data.map((d, i) => {
    const planned = d[plannedKey];
    const c = planned ? "#f59e0b" : "#00c8e6";
    return `<rect x="${sx(i)}" y="${sy(d[yKey])}" width="${bw}" height="${H-P-sy(d[yKey])}" fill="${c}" opacity="${planned?0.6:0.9}"/>
      <text x="${sx(i)+bw/2}" y="${sy(d[yKey])-3}" fill="#e6edf3" font-size="9" text-anchor="middle">${d[yKey]}</text>`;
  }).join("");
  const xTicks = data.map((d, i) => `<text x="${sx(i)+bw/2}" y="${H-12}" fill="#9aa4b2" font-size="9" text-anchor="middle">${d[xKey]}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${bars}${xTicks}
    <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="#233042"/>
    <text x="14" y="${H/2}" fill="#9aa4b2" font-size="9" text-anchor="middle" transform="rotate(-90 14 ${H/2})">${yLabel}</text>
    <g transform="translate(${W-110}, ${P-20})">
      <rect width="10" height="6" fill="#00c8e6"/><text x="14" y="6" fill="#e6edf3" font-size="9">actual</text>
      <rect x="58" width="10" height="6" fill="#f59e0b" opacity="0.6"/><text x="72" y="6" fill="#e6edf3" font-size="9">planned</text>
    </g>
  </svg>`;
}

function priceChart({W=440, H=200, P=36}) {
  const data = TRENDS.wavelengthPrices;
  const ymax = Math.max(...data.map(d => Math.max(d.q2021, d.q2024))) * 1.1;
  const bw = (W - 2*P) / data.length * 0.4;
  const sx = i => P + i * (W - 2*P) / data.length + (W - 2*P) / data.length * 0.05;
  const sy = v => H - P - (v / ymax) * (H - 2*P);
  const bars = data.map((d, i) => {
    return `<rect x="${sx(i)}" y="${sy(d.q2021)}" width="${bw}" height="${H-P-sy(d.q2021)}" fill="#5f6b7a"/>
      <rect x="${sx(i)+bw+3}" y="${sy(d.q2024)}" width="${bw}" height="${H-P-sy(d.q2024)}" fill="#00c8e6"/>
      <text x="${sx(i)+bw}" y="${sy(d.q2024)-3}" fill="#f5b400" font-size="9" text-anchor="middle">${d.cagr}%</text>`;
  }).join("");
  const xTicks = data.map((d, i) => `<text x="${sx(i)+bw}" y="${H-12}" fill="#9aa4b2" font-size="8" text-anchor="middle">${d.route.length>14?d.route.slice(0,12)+'…':d.route}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${bars}${xTicks}
    <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="#233042"/>
    <text x="14" y="${H/2}" fill="#9aa4b2" font-size="9" text-anchor="middle" transform="rotate(-90 14 ${H/2})">USD $K/month</text>
    <g transform="translate(${P}, ${P-22})">
      <rect width="10" height="6" fill="#5f6b7a"/><text x="14" y="6" fill="#e6edf3" font-size="9">Q4 2021</text>
      <rect x="68" width="10" height="6" fill="#00c8e6"/><text x="82" y="6" fill="#e6edf3" font-size="9">Q4 2024</text>
      <text x="138" y="6" fill="#f5b400" font-size="9">orange = CAGR</text>
    </g>
  </svg>`;
}

function renderTrendsView() {
  trendsViewEl.innerHTML = `
    <div class="view-toolbar">
      <h2>Industry Trends · TeleGeography 2026</h2>
      <span style="color:var(--text-mute); font-size:11px;">Time-series context for TTI portfolio decisions</span>
    </div>
    <div class="trend-grid">
      <div class="trend-card">
        <h3>Subsea cable CapEx (USD B)</h3>
        <div class="sub">2016-2024 actual · 2025-2027 planned. Pipeline reaches $14B+ over 3 years (TG2026).</div>
        ${barChart({data:TRENDS.subseaCapex, xKey:'y', yKey:'v', yLabel:'USD B'})}
      </div>
      <div class="trend-card">
        <h3>Int'l bandwidth demand growth % YoY by region</h3>
        <div class="sub">Africa leads at 40%+ CAGR. Most regions slowing toward 25-30%.</div>
        ${lineChart({data:TRENDS.bandwidthDemand, xKey:'y', series:['africa','mideast','asia','europe','americas'], yLabel:'% YoY'})}
      </div>
      <div class="trend-card">
        <h3>100G wavelength price (USD K/mo) Q4'21 → Q4'24</h3>
        <div class="sub">Routes with new capacity erode fast; supply-constrained routes (Marseille-SG) only -2% CAGR.</div>
        ${priceChart({})}
      </div>
      <div class="trend-card">
        <h3>AI mega-DC capacity (cumulative MW)</h3>
        <div class="sub">Operational vs planned. Reflects xAI/Meta/Stargate/Rainier/HUMAIN/Stargate UAE pipelines.</div>
        ${lineChart({data:TRENDS.aiCapacity, xKey:'y', series:['online','planned'], yLabel:'MW cumulative', colors:['#00c8e6','#ec4899']})}
      </div>
      <div class="trend-card">
        <h3>New cloud regions launched per year</h3>
        <div class="sub">Peak 45 in 2019 → 13 in 2024 (slowdown). 35+ planned for 2025-26 (mostly Azure, GCP).</div>
        ${barChart({data:TRENDS.cloudRegions, xKey:'y', yKey:'n', yLabel:'# new regions'})}
      </div>
      <div class="trend-card">
        <h3>TTI portfolio capacity buildup (Tbps design)</h3>
        <div class="sub">Live from dataset — cumulative TTI cable design capacity by RFS year.</div>
        ${(() => {
          const tti = CABLES.filter(c => c.ownerGroup === 'tti' && c.capacity_tbps_design);
          const byYear = {};
          tti.forEach(c => {
            const y = parseInt((c.rfs_date||"").slice(0,4));
            if (!isNaN(y)) byYear[y] = (byYear[y]||0) + c.capacity_tbps_design;
          });
          const years = Object.keys(byYear).map(Number).sort();
          let cum = 0;
          const data = years.map(y => ({ y, v: (cum += byYear[y]) }));
          return barChart({data, xKey:'y', yKey:'v', yLabel:'Tbps cumulative'});
        })()}
      </div>
    </div>`;
}

/* ============================================================
 * STRATEGY SIMULATOR
 * ============================================================ */
const STRATEGY = {
  inputs: {
    redSeaPremium: 15,         // % premium TTI can charge for Red Sea bypass routes
    hyperscalerIRU: 25,        // % of TTI capacity sold as IRU/dark fiber to hyperscalers
    upgrade400g: 2027,         // year TTI completes 400GigE core upgrade
    aiAnchorMW: 100,           // MW of AI DC anchor tenant TTI lands by 2028
    kafosUpgrade: 0            // USD M invested in KAFOS Black Sea upgrade
  },
  presets: {
    "Status Quo": { redSeaPremium:0, hyperscalerIRU:10, upgrade400g:2029, aiAnchorMW:0, kafosUpgrade:0 },
    "Red Sea Pivot": { redSeaPremium:30, hyperscalerIRU:20, upgrade400g:2027, aiAnchorMW:50, kafosUpgrade:30 },
    "Hyperscaler Partner": { redSeaPremium:15, hyperscalerIRU:55, upgrade400g:2026, aiAnchorMW:200, kafosUpgrade:15 },
    "AI Hub Türkiye": { redSeaPremium:20, hyperscalerIRU:35, upgrade400g:2026, aiAnchorMW:400, kafosUpgrade:50 }
  }
};

function computeStrategyKPIs() {
  const i = STRATEGY.inputs;
  const ttiCables = CABLES.filter(c => c.ownerGroup === 'tti');
  const baseRevenue = ttiCables.reduce((s,c) => s + (c.revenue_potential_usd_m||0), 0); // baseline
  // Premium revenue from Red Sea bypass: applied to TTI Eurasian + Balkan + PEACE + KAFOS share
  const bypassRev = baseRevenue * 0.55 * (i.redSeaPremium/100);
  // Hyperscaler IRU: assume avg $4M per % point of capacity sold annually
  const iruRev = i.hyperscalerIRU * 4.2;
  // AI anchor tenant: dedicated cross-connect + transport at ~$0.15M/MW/yr
  const aiRev = i.aiAnchorMW * 0.15;
  // 400G upgrade: each year earlier than 2029 = +$8M/yr capture
  const upgradeBoost = Math.max(0, 2029 - i.upgrade400g) * 8;
  // KAFOS upgrade: 18% IRR assumed
  const kafosRev = i.kafosUpgrade * 0.18;

  const totalAnnualRev5y = baseRevenue + bypassRev + iruRev + aiRev + upgradeBoost + kafosRev;
  const revUplift = ((totalAnnualRev5y/baseRevenue - 1) * 100);

  // CapEx required
  const capex = (i.hyperscalerIRU > 30 ? 80 : 30) +
                (Math.max(0, 2029 - i.upgrade400g) * 35) +
                i.kafosUpgrade +
                (i.aiAnchorMW * 0.8);

  // 5-yr NPV approx (10% discount)
  const npv5 = totalAnnualRev5y * 3.79 - capex;

  // Strategic value composite (weighted)
  const stratValue = Math.min(10,
    (ttiCables.reduce((s,c) => s + (c.strategic_value_score||0), 0) / ttiCables.length) +
    (i.redSeaPremium / 30) +
    (i.hyperscalerIRU / 60) +
    (i.aiAnchorMW / 200) +
    (Math.max(0, 2029 - i.upgrade400g) / 5)
  );

  // TTI capacity share of global subsea pipeline (Tbps)
  const globalDesign = CABLES.reduce((s,c) => s + (c.capacity_tbps_design||0), 0);
  const ttiDesign = ttiCables.reduce((s,c) => s + (c.capacity_tbps_design||0), 0);
  const baseShare = ttiDesign / globalDesign * 100;
  const adjShare = baseShare * (1 + i.hyperscalerIRU/100 * 0.3 + i.kafosUpgrade/500);

  return {
    baseRevenue, totalAnnualRev5y, revUplift, capex, npv5,
    stratValue, baseShare, adjShare,
    bypassRev, iruRev, aiRev, upgradeBoost, kafosRev
  };
}

function renderStrategyView() {
  const i = STRATEGY.inputs;
  const k = computeStrategyKPIs();

  strategyViewEl.innerHTML = `
    <div class="view-toolbar">
      <h2>Strategic Scenario Simulator</h2>
      <span style="color:var(--text-mute); font-size:11px;">Adjust levers · KPIs recompute live · framed by TG2026 industry context</span>
    </div>
    <div class="strategy-layout">
      <div class="strategy-controls">
        <h3>Strategic levers</h3>
        <div class="preset-row" id="preset-row">
          ${Object.keys(STRATEGY.presets).map(p => `<button class="preset-btn" data-preset="${p}">${p}</button>`).join("")}
        </div>

        <div class="slider-group">
          <div class="lbl"><span>Red Sea bypass premium</span><span class="val">${i.redSeaPremium}%</span></div>
          <input type="range" min="0" max="50" step="1" value="${i.redSeaPremium}" data-input="redSeaPremium"/>
          <div class="desc">% surcharge TTI captures on Türkiye-routed traffic avoiding Yemeni-water risk.</div>
        </div>

        <div class="slider-group">
          <div class="lbl"><span>Hyperscaler IRU / dark fiber sales</span><span class="val">${i.hyperscalerIRU}%</span></div>
          <input type="range" min="0" max="80" step="1" value="${i.hyperscalerIRU}" data-input="hyperscalerIRU"/>
          <div class="desc">% of TTI design capacity sold as long-term IRU to Meta/Google/MSFT/AWS. TG2026: content/cloud = ~75% of demand.</div>
        </div>

        <div class="slider-group">
          <div class="lbl"><span>400GigE core upgrade complete by</span><span class="val">${i.upgrade400g}</span></div>
          <input type="range" min="2026" max="2030" step="1" value="${i.upgrade400g}" data-input="upgrade400g"/>
          <div class="desc">TG2026: 400GigE rolling out in EU/US hubs at $0.08-0.09/Mbps (3.3× 100GigE). Earlier = more share.</div>
        </div>

        <div class="slider-group">
          <div class="lbl"><span>AI DC anchor tenant landed</span><span class="val">${i.aiAnchorMW} MW</span></div>
          <input type="range" min="0" max="500" step="10" value="${i.aiAnchorMW}" data-input="aiAnchorMW"/>
          <div class="desc">MW of AI hyperscaler tenant TTI lands by 2028 (cross-connect + transport revenue).</div>
        </div>

        <div class="slider-group">
          <div class="lbl"><span>KAFOS Black Sea upgrade investment</span><span class="val">$${i.kafosUpgrade}M</span></div>
          <input type="range" min="0" max="80" step="5" value="${i.kafosUpgrade}" data-input="kafosUpgrade"/>
          <div class="desc">CapEx for Black Sea ring re-spectrum / new fiber pair lease (Caucasus diversity).</div>
        </div>
      </div>

      <div class="strategy-output">
        <div class="out-kpi">
          <div class="k">Annual revenue (Y1)</div>
          <div class="v">$${k.totalAnnualRev5y.toFixed(0)}M</div>
          <div class="delta ${k.revUplift>0?'pos':k.revUplift<0?'neg':''}">${k.revUplift>=0?'+':''}${k.revUplift.toFixed(1)}% vs baseline ($${k.baseRevenue.toFixed(0)}M)</div>
        </div>
        <div class="out-kpi">
          <div class="k">5-yr NPV (10% disc.)</div>
          <div class="v">$${k.npv5.toFixed(0)}M</div>
          <div class="delta">CapEx required: $${k.capex.toFixed(0)}M</div>
        </div>
        <div class="out-kpi">
          <div class="k">TTI capacity share</div>
          <div class="v">${k.adjShare.toFixed(2)}%</div>
          <div class="delta ${k.adjShare>k.baseShare?'pos':''}">+${(k.adjShare-k.baseShare).toFixed(2)} pp vs baseline ${k.baseShare.toFixed(2)}%</div>
        </div>
        <div class="out-kpi">
          <div class="k">Strategic value composite</div>
          <div class="v">${k.stratValue.toFixed(1)}/10</div>
          <div class="delta">portfolio strategic_value avg + lever boosts</div>
        </div>

        <div class="out-chart">
          <h4>Revenue uplift breakdown (USD M/yr)</h4>
          ${(() => {
            const items = [
              {label:"Baseline TTI revenue", v:k.baseRevenue, c:"#5f6b7a"},
              {label:"Red Sea bypass premium", v:k.bypassRev, c:"#f59e0b"},
              {label:"Hyperscaler IRU", v:k.iruRev, c:"#3b82f6"},
              {label:"AI anchor tenant", v:k.aiRev, c:"#ec4899"},
              {label:"400G upgrade capture", v:k.upgradeBoost, c:"#00c8e6"},
              {label:"KAFOS upgrade", v:k.kafosRev, c:"#84cc16"}
            ];
            const max = Math.max(...items.map(it => it.v));
            return `<div style="font-size:11px;font-family:var(--mono)">
              ${items.map(it => `
                <div style="display:grid;grid-template-columns:180px 1fr 80px;align-items:center;gap:10px;margin-bottom:6px;">
                  <span style="color:var(--text-dim);font-family:var(--sans);">${it.label}</span>
                  <div class="bar-bg" style="height:14px;"><div class="bar-fill" style="background:${it.c};height:14px;width:${(it.v/max*100).toFixed(1)}%"></div></div>
                  <span style="text-align:right;color:var(--text);">$${it.v.toFixed(1)}M</span>
                </div>`).join("")}
            </div>`;
          })()}
        </div>

        <div class="out-chart">
          <h4>Scenario narrative</h4>
          <p style="margin:0;font-size:12px;line-height:1.6;color:var(--text-dim);">
            ${i.redSeaPremium >= 25 ? `<strong>Red Sea pivot:</strong> TTI prices Türkiye-routed transit at +${i.redSeaPremium}% premium — viable while Houthi risk persists. Pair with WorldLink/EXA-SOCAR partnerships. ` : ''}
            ${i.hyperscalerIRU >= 40 ? `<strong>Hyperscaler-led wholesale:</strong> ${i.hyperscalerIRU}% of capacity locked into long-term IRUs with Meta/Google/MSFT/AWS — secures revenue but cedes pricing power. ` : ''}
            ${i.upgrade400g <= 2026 ? `<strong>400G first mover:</strong> Core upgraded by ${i.upgrade400g} — captures premium ports vs late-mover EU competitors. ` : ''}
            ${i.aiAnchorMW >= 200 ? `<strong>AI Hub Türkiye:</strong> ${i.aiAnchorMW} MW AI anchor tenant secured — drives ~$${k.aiRev.toFixed(1)}M/yr in transport + cross-connect. Requires power-security narrative (post TG2026 4-yr wait crisis). ` : ''}
            ${i.kafosUpgrade >= 30 ? `<strong>Black Sea play:</strong> KAFOS upgrade ($${i.kafosUpgrade}M CapEx) opens Caucasus diversity premium. ` : ''}
            ${i.redSeaPremium<10 && i.hyperscalerIRU<20 && i.aiAnchorMW<50 ? '<strong>Status quo:</strong> TTI stays in traditional wholesale lane — revenue grows with global bandwidth demand but share is stable.' : ''}
          </p>
        </div>
      </div>
    </div>`;

  strategyViewEl.querySelectorAll('input[type="range"]').forEach(inp => {
    inp.addEventListener("input", (e) => {
      STRATEGY.inputs[e.target.dataset.input] = Number(e.target.value);
      renderStrategyView();
    });
  });
  strategyViewEl.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener("click", () => {
      const p = STRATEGY.presets[btn.dataset.preset];
      Object.assign(STRATEGY.inputs, p);
      renderStrategyView();
    });
  });
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

/* Market Context modal */
const ctxOverlay = document.getElementById("ctx-overlay");
document.getElementById("show-context").addEventListener("click", () => ctxOverlay.classList.add("open"));
document.getElementById("ctx-close").addEventListener("click", () => ctxOverlay.classList.remove("open"));
ctxOverlay.addEventListener("click", (e) => { if (e.target === ctxOverlay) ctxOverlay.classList.remove("open"); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") ctxOverlay.classList.remove("open"); });

setView("map");
