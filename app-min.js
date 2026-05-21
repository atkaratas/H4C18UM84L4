/* ============================================================
 * TTI Cable Benchmark — Minimal v1
 *
 * One file, one purpose: pick up to 3 cables from the sidebar,
 * see them drawn correctly on the map (TG-verified geometry,
 * antimeridian-safe), and compare them in the right panel.
 *
 * Design:
 *   - Single STATE object is the source of truth.
 *   - render() reads STATE and rebuilds map + sidebar + right pane.
 *   - All mutations call render(); no incremental DOM patching.
 *   - The map only ever shows what's in STATE.pinned.
 * ============================================================ */

(() => {
"use strict";

/* ------------------------------------------------------------
 * STATE — only mutate through setters that call render()
 * ------------------------------------------------------------ */
const STATE = {
  pinned: [],       // cable ids, max 3
  search: "",
  group: "",        // "", "tti", "competitor", "hyperscaler", "subsea"
  tgReady: false,
};
const MAX_PINS = 3;

/* ------------------------------------------------------------
 * DATA — only cables; the larger ASSETS list contains POPs/IXPs
 * that the minimal version doesn't visualise.
 * ------------------------------------------------------------ */
const CABLES = ASSETS.filter(a => a.type === "subsea" || a.type === "terrestrial");
const CABLES_BY_ID = Object.fromEntries(CABLES.map(c => [c.id, c]));
const TG = { cables: null, landings: null };

/* ------------------------------------------------------------
 * GEOMETRY HELPERS
 * ------------------------------------------------------------ */

// Stop Leaflet from drawing transpacific cables the wrong way around the globe.
function normalizeGeometry(coords) {
  if (!coords || coords.length < 2) return coords;
  const out = [coords[0].slice()];
  for (let i = 1; i < coords.length; i++) {
    let [lat, lng] = coords[i];
    const prevLng = out[i-1][1];
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    out.push([lat, lng]);
  }
  return out;
}

// Return the list of polylines (each is a [lat,lng][]) to draw for a cable.
// Prefers TG verified multi-segment data; falls back to hand-drawn geometry.
function getCableSegments(c) {
  const tgId = TG_OVERRIDES[c.id];
  if (tgId && TG.cables && TG.cables[tgId]) {
    return TG.cables[tgId].segments.map(seg =>
      normalizeGeometry(seg.map(([lng, lat]) => [lat, lng]))
    );
  }
  return c.geometry ? [normalizeGeometry(c.geometry)] : [];
}

function getCableLandings(c) {
  // Hand-curated landings take priority (they include city names).
  if (c.landings && c.landings.length) return c.landings;
  return [];
}

function cableGroup(c) {
  if (c.ownerGroup === "tti") return "tti";
  if (c.layer === "hs-subsea") return "hyperscaler";
  if (c.layer === "competitor-cable") return "competitor";
  return "subsea";
}

function cableColor(c) {
  const g = cableGroup(c);
  if (g === "tti") return "#00c8e6";
  if (g === "competitor") return "#f59e0b";
  if (g === "hyperscaler") return "#3b82f6";
  return "#8b5cf6";
}

function fmt(v, unit) {
  if (v == null || v === "") return "—";
  return v + (unit ? `<span class="u">${unit}</span>` : "");
}
function est(c, k) { return c[k + "_est"] ? ` <span class="est">est</span>` : ""; }

/* ------------------------------------------------------------
 * MAP
 * ------------------------------------------------------------ */
const map = L.map("map", {
  worldCopyJump: true,
  zoomControl: true,
  preferCanvas: false,
}).setView([25, 30], 3);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
  attribution: "© OpenStreetMap © CARTO · TeleGeography",
  maxZoom: 12, minZoom: 2,
}).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", {
  pane: "shadowPane", maxZoom: 12, minZoom: 2,
}).addTo(map);

const mapLayer = L.layerGroup().addTo(map); // everything map-rendered lives here

function popupCable(c) {
  const owner = (c.owner || c.operator || "").split(",")[0].trim();
  return `<div class="pt">${c.name}</div>
    <div class="pm">${owner}</div>
    <div class="pm">${c.type} · RFS ${c.rfs_date || "—"}</div>
    <div class="pm">${fmt(c.capacity_tbps_design, " Tbps design")}</div>`;
}

function drawCable(c) {
  const color = cableColor(c);
  const segments = getCableSegments(c);
  const dash = c.type === "terrestrial" ? "6,5" : null;
  const tti = cableGroup(c) === "tti";

  segments.forEach((seg, i) => {
    if (!seg || seg.length < 2) return;
    const line = L.polyline(seg, {
      color,
      weight: i === 0 ? (tti ? 3.4 : 2.4) : (tti ? 2.4 : 1.6),
      opacity: i === 0 ? 0.95 : 0.7,
      dashArray: dash,
    });
    line.bindPopup(popupCable(c));
    line.on("click", e => { L.DomEvent.stopPropagation(e); /* keep popup */ });
    line.addTo(mapLayer);
  });

  getCableLandings(c).forEach(lg => {
    const m = L.circleMarker([lg.lat, lg.lng], {
      radius: 4, color, weight: 1.5, fillColor: "#001018", fillOpacity: 1,
    });
    m.bindPopup(`<div class="pt">${lg.name}</div><div class="pm">${c.name} landing</div>`);
    m.addTo(mapLayer);
  });
}

function renderMap() {
  mapLayer.clearLayers();
  if (!STATE.pinned.length) return;

  STATE.pinned.forEach(id => {
    const c = CABLES_BY_ID[id];
    if (c) drawCable(c);
  });

  // Fit map to bounds of every pinned cable's geometry
  const all = [];
  STATE.pinned.forEach(id => {
    const c = CABLES_BY_ID[id];
    if (!c) return;
    getCableSegments(c).forEach(seg => seg.forEach(p => all.push(p)));
    getCableLandings(c).forEach(lg => all.push([lg.lat, lg.lng]));
  });
  if (all.length >= 2) {
    map.flyToBounds(L.latLngBounds(all).pad(0.15), {
      maxZoom: STATE.pinned.length === 1 ? 5 : 4,
      duration: 0.8,
    });
  }
}

/* ------------------------------------------------------------
 * SIDEBAR
 * ------------------------------------------------------------ */
const $list = document.getElementById("cable-list");
const $search = document.getElementById("search");
const $group = document.getElementById("filter-group");
const $pinCount = document.getElementById("pin-count");
const $cableCount = document.getElementById("cable-count");

function filteredCables() {
  const q = STATE.search.trim().toLowerCase();
  return CABLES.filter(c => {
    if (STATE.group && cableGroup(c) !== STATE.group) return false;
    if (!q) return true;
    return (c.name + " " + (c.owner || c.operator || "")).toLowerCase().includes(q);
  });
}

function renderSidebar() {
  const list = filteredCables();
  $pinCount.textContent = `${STATE.pinned.length}/${MAX_PINS}`;
  $cableCount.textContent = `(${list.length}/${CABLES.length})`;

  $list.innerHTML = list.map(c => {
    const isPinned = STATE.pinned.includes(c.id);
    return `<label class="cable-row ${isPinned ? "pinned" : ""}">
      <input type="checkbox" data-id="${c.id}" ${isPinned ? "checked" : ""} />
      <span class="dot" style="background:${cableColor(c)}"></span>
      <span class="name" title="${c.name}">${c.name}</span>
      <span class="group">${cableGroup(c)}</span>
    </label>`;
  }).join("");
}

$search.addEventListener("input", e => { STATE.search = e.target.value; renderSidebar(); });
$group.addEventListener("change", e => { STATE.group = e.target.value; renderSidebar(); });
$list.addEventListener("change", e => {
  const cb = e.target;
  if (!cb.matches('input[type="checkbox"]')) return;
  togglePin(cb.dataset.id);
});

/* ------------------------------------------------------------
 * PINS
 * ------------------------------------------------------------ */
function togglePin(id) {
  const i = STATE.pinned.indexOf(id);
  if (i >= 0) {
    STATE.pinned.splice(i, 1);
  } else if (STATE.pinned.length < MAX_PINS) {
    STATE.pinned.push(id);
  } else {
    alert(`En fazla ${MAX_PINS} kablo seçilebilir. Önce birini kaldırın.`);
    return;
  }
  render();
}
function clearPins() { STATE.pinned = []; render(); }

/* ------------------------------------------------------------
 * RIGHT PANEL
 * ------------------------------------------------------------ */
const $right = document.getElementById("right-panel");

function renderRight() {
  if (STATE.pinned.length === 0) {
    $right.innerHTML = `<div class="empty-state">
      <div class="icon">⊟</div>
      <div class="title">Soldan kablo seçin</div>
      <div class="hint">Karşılaştırmak için max ${MAX_PINS} kablo tikleyin.<br/>Harita otomatik zoom yapar, burada benchmark tablosu çıkar.</div>
    </div>`;
    return;
  }
  if (STATE.pinned.length === 1) {
    renderDetail(CABLES_BY_ID[STATE.pinned[0]]);
  } else {
    renderBenchmark(STATE.pinned.map(id => CABLES_BY_ID[id]).filter(Boolean));
  }
}

function renderDetail(c) {
  if (!c) return;
  const owner = c.owner || c.operator || "";
  const group = cableGroup(c);
  const tgVerified = TG_OVERRIDES[c.id] && TG.cables && TG.cables[TG_OVERRIDES[c.id]];

  $right.innerHTML = `<div class="detail">
    <h2>${c.name}</h2>
    <div>
      <span class="tag">${c.type}</span>
      <span class="tag" style="color:${cableColor(c)}">${group}</span>
      ${tgVerified ? `<span class="tag" style="color:var(--accent)">TG verified</span>` : ""}
    </div>
    <div class="owner">${owner}</div>

    <div class="kpi-grid">
      <div class="kpi"><div class="k">Capacity (design)${est(c,'capacity_tbps_design')}</div><div class="v">${fmt(c.capacity_tbps_design," Tbps")}</div></div>
      <div class="kpi"><div class="k">Capacity (lit)${est(c,'capacity_tbps_lit')}</div><div class="v">${fmt(c.capacity_tbps_lit," Tbps")}</div></div>
      <div class="kpi"><div class="k">CapEx${est(c,'capex_usd_m')}</div><div class="v">${fmt(c.capex_usd_m," M$")}</div></div>
      <div class="kpi"><div class="k">OpEx / yr${est(c,'opex_annual_usd_m')}</div><div class="v">${fmt(c.opex_annual_usd_m," M$")}</div></div>
      <div class="kpi"><div class="k">Revenue pot.${est(c,'revenue_potential_usd_m')}</div><div class="v">${fmt(c.revenue_potential_usd_m," M$")}</div></div>
      <div class="kpi"><div class="k">Strategic</div><div class="v">${fmt(c.strategic_value_score," /10")}</div></div>
      <div class="kpi"><div class="k">Diversity</div><div class="v">${fmt(c.route_diversity_score," /10")}</div></div>
      <div class="kpi"><div class="k">Owned %${est(c,'segments_owned_pct')}</div><div class="v">${fmt(c.segments_owned_pct,"%")}</div></div>
    </div>

    <div class="meta-row"><span class="k">RFS</span><span class="v">${c.rfs_date || "—"}</span></div>
    <div class="meta-row"><span class="k">Status</span><span class="v">${c.status || "—"}</span></div>
    ${c.latency_ms_key_pair ? `<div class="meta-row"><span class="k">Latency</span><span class="v">${c.latency_ms_key_pair.value} ms <span style="color:var(--text-mute)">(${c.latency_ms_key_pair.pair})</span></span></div>` : ""}
    <div class="meta-row"><span class="k">Landings</span><span class="v">${(c.landings||[]).map(l => l.name).join(" · ") || "—"}</span></div>
    ${c.partners ? `<div class="meta-row"><span class="k">Partners</span><span class="v">${c.partners.join(", ")}</span></div>` : ""}

    ${c.notes ? `<div class="notes">${c.notes}</div>` : ""}

    <div class="bench actions">
      <button class="btn" id="btn-zoom">Tekrar zoom</button>
      <button class="btn danger" id="btn-unpin">Seçimi kaldır</button>
    </div>
  </div>`;

  document.getElementById("btn-zoom").addEventListener("click", () => renderMap());
  document.getElementById("btn-unpin").addEventListener("click", () => togglePin(c.id));
}

function renderBenchmark(cables) {
  cables = cables.slice().sort((a,b) => (b.strategic_value_score||0) - (a.strategic_value_score||0));

  const rows = [
    { k:"capacity_tbps_design", label:"Tbps (design)", u:"" },
    { k:"capacity_tbps_lit",    label:"Tbps (lit)",    u:"" },
    { k:"capex_usd_m",          label:"CapEx",         u:" M$" },
    { k:"opex_annual_usd_m",    label:"OpEx/yr",       u:" M$" },
    { k:"revenue_potential_usd_m", label:"Revenue pot.", u:" M$" },
    { k:"strategic_value_score",label:"Strategic",     u:" /10" },
    { k:"route_diversity_score",label:"Diversity",     u:" /10" },
    { k:"segments_owned_pct",   label:"Owned share",   u:"%" },
  ];

  const best = {};
  rows.forEach(r => {
    const vs = cables.map(c => c[r.k]).filter(v => v != null);
    if (vs.length) best[r.k] = Math.max(...vs);
  });

  $right.innerHTML = `<div class="bench">
    <h2>Benchmark</h2>
    <div class="meta">${cables.length}/${MAX_PINS} seçili · stratejik değere göre sıralı · ✓ = kategori liderlik</div>
    <table>
      <thead><tr>
        <th>Metric</th>
        ${cables.map(c => `<th><div class="name" title="${c.name}">${c.name}</div><div class="grp" style="color:${cableColor(c)}">${cableGroup(c)}</div></th>`).join("")}
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td class="metric">${r.label}</td>
          ${cables.map(c => {
            const v = c[r.k];
            const isBest = v != null && v === best[r.k] && cables.length > 1;
            return `<td class="${isBest ? "best" : ""}">${v != null ? v + r.u : "—"}${isBest ? " ✓" : ""}</td>`;
          }).join("")}
        </tr>`).join("")}
        <tr><td class="metric">Latency (ms)</td>
          ${cables.map(c => `<td>${c.latency_ms_key_pair ? c.latency_ms_key_pair.value + ` <span style="color:var(--text-mute);font-size:9px">${c.latency_ms_key_pair.pair}</span>` : "—"}</td>`).join("")}
        </tr>
        <tr><td class="metric">Status</td>
          ${cables.map(c => `<td>${c.status || "—"}</td>`).join("")}
        </tr>
        <tr><td class="metric">RFS</td>
          ${cables.map(c => `<td>${c.rfs_date || "—"}</td>`).join("")}
        </tr>
      </tbody>
    </table>
    <div class="actions">
      <button class="btn" id="btn-refit">Hepsini sığdır</button>
      <button class="btn danger" id="btn-clear">Tümünü kaldır</button>
    </div>
  </div>`;

  document.getElementById("btn-refit").addEventListener("click", () => renderMap());
  document.getElementById("btn-clear").addEventListener("click", clearPins);
}

/* ------------------------------------------------------------
 * RENDER (the only function callers should reach for)
 * ------------------------------------------------------------ */
function render() {
  renderSidebar();
  renderMap();
  renderRight();
}

/* ------------------------------------------------------------
 * BOOT — load TG verified geometry asynchronously
 * ------------------------------------------------------------ */
document.getElementById("hdr-counts").textContent =
  `${CABLES.length} cables loaded`;

async function loadTG() {
  const $status = document.getElementById("status");
  const $hdr = document.getElementById("hdr-sub");
  try {
    $status.textContent = "TG: loading…";
    const [cgRes, lgRes] = await Promise.all([
      fetch("tg/cable-geo.json"),
      fetch("tg/landing-geo.json"),
    ]);
    if (!cgRes.ok || !lgRes.ok) throw new Error("TG fetch failed");
    const cg = await cgRes.json();
    const lg = await lgRes.json();

    const byId = {};
    cg.features.forEach(f => {
      const id = f.properties.id;
      if (!byId[id]) byId[id] = { id, name: f.properties.name, segments: [] };
      byId[id].segments.push(f.geometry.coordinates);
    });
    TG.cables = byId;

    const landings = {};
    lg.features.forEach(f => {
      landings[f.properties.id] = {
        name: f.properties.name,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      };
    });
    TG.landings = landings;
    STATE.tgReady = true;
    $status.classList.add("ok");
    $status.textContent = `TG ready · ${Object.keys(byId).length} cables`;
    $hdr.textContent = `${Object.keys(byId).length} TG cables verified`;
    render(); // re-draw any pinned cables with TG geometry
  } catch (err) {
    console.warn("TG load failed:", err);
    $status.textContent = `TG load failed (${err.message}) — using hand-drawn geometry`;
    $hdr.textContent = "TG load failed";
  }
}

console.log(`%c[Cable Benchmark Minimal v1]%c ${CABLES.length} cables loaded — pick up to ${MAX_PINS}`,
  "color:#00c8e6;font-weight:bold", "color:inherit");

render();
loadTG();

})();
