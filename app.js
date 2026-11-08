"use strict";
// Head dashboard and manual. Static page: all data is read from the private repo head-data
// through the GitHub API with a token the user saves in this browser.
const OWNER = "tsiazkiewicz", DATA_REPO = "head-data";
const KIND = { "nightly-job": "Nightly", "weekly-job": "Weekly", "on-demand": "On demand", "event": "On event", "app": "App", "data-store": "Data" };
const view = document.getElementById("view");

// ---------- helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
function getToken() { try { return localStorage.getItem("head.token") || ""; } catch (e) { return ""; } }
function setToken(t) { try { t ? localStorage.setItem("head.token", t) : localStorage.removeItem("head.token"); } catch (e) { } }

async function gh(path, asJson) {
  const token = getToken();
  if (!token) throw new Error("NO_TOKEN");
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${DATA_REPO}/contents/${path}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Accept: asJson ? "application/vnd.github+json" : "application/vnd.github.raw+json" }
  });
  if (!r.ok) {
    let detail = ""; try { detail = (await r.json()).message || ""; } catch (e) { }
    if (r.status === 401 || r.status === 403) throw new Error(`BAD_TOKEN|${r.status}|${detail}`);
    if (r.status === 404) throw new Error(`MISSING|${path}|${detail}`);
    throw new Error(`HTTP|${r.status}|${detail}`);
  }
  return asJson ? r.json() : r.text();
}
async function loadRegistry() {
  const [areasTxt, listing] = await Promise.all([gh("registry/areas.json"), gh("registry/features", true)]);
  const areas = JSON.parse(areasTxt).areas.sort((a, b) => a.order - b.order);
  const files = listing.filter(f => f.name.endsWith(".json"));
  const feats = await Promise.all(files.map(async f => JSON.parse(await gh("registry/features/" + f.name))));
  return { areas, feats };
}
async function loadHistory() {
  try { return (await gh("history.jsonl")).split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch (e) { return []; }
}
function problem(e) {
  const m = String(e.message || e), [code, a, b] = m.split("|");
  if (code === "NO_TOKEN") return `<div class="notice">No access token saved yet. Open <a href="#/settings">Settings</a> and paste your token.</div>`;
  if (code === "BAD_TOKEN") return `<div class="notice err">GitHub answered ${esc(a)}: ${esc(b || "no details")}.<br>The token may be expired, mistyped, or missing the Contents permission. Check it in <a href="#/settings">Settings</a>.</div>`;
  if (code === "MISSING") return `<div class="notice err">GitHub could not find ${esc(a)}${b ? " (" + esc(b) + ")" : ""}. For a private repository this also happens when the token does not include head-data. Check the token\u2019s repository access.</div>`;
  if (code === "HTTP") return `<div class="notice err">GitHub answered ${esc(a)}: ${esc(b || "no details")}.</div>`;
  return `<div class="notice err">Could not load data: ${esc(m)}</div>`;
}

// ---------- diagrams ----------
const NW = 210, NH = 46;
function nodeSvg(f, x, y, ghost, areaName) {
  const cls = ghost ? "ghost" : f.status;
  const label = ghost ? `${areaName} · ${KIND[f.kind] || f.kind}` : (KIND[f.kind] || f.kind);
  return `<a href="#/manual/${esc(f.area)}/${esc(f.id)}"><g class="node ${cls}" transform="translate(${x},${y})">
    <rect width="${NW}" height="${NH}" rx="12"/>
    <text x="12" y="19">${esc(short(f.name, 27))}</text>
    <text class="k" x="12" y="35">${esc(label)}</text></g></a>`;
}
function defs() {
  return `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>`;
}
function overviewSvg(areas, feats) {
  const AW = 250, GAP = 22, COLS = 3, HEAD = 54, CH = 52;
  const boxes = areas.map(a => ({ a, fs: feats.filter(f => f.area === a.id).sort((x, y) => x.name.localeCompare(y.name)) }));
  boxes.forEach(b => b.h = HEAD + Math.max(b.fs.length, 1) * CH + 10);
  const rows = []; boxes.forEach((b, i) => { (rows[Math.floor(i / COLS)] = rows[Math.floor(i / COLS)] || []).push(b); });
  let y = 0, out = "";
  rows.forEach(r => {
    const rh = Math.max(...r.map(b => b.h));
    r.forEach((b, c) => {
      const x = c * (AW + GAP);
      out += `<g class="area"><a href="#/manual/${esc(b.a.id)}"><rect x="${x}" y="${y}" width="${AW}" height="${rh}" rx="18"/>
        <text class="t" x="${x + 16}" y="${y + 26}">${esc(b.a.name)}</text>
        <text class="s" x="${x + 16}" y="${y + 43}">${b.fs.length} ${b.fs.length === 1 ? "feature" : "features"}</text></a></g>`;
      if (!b.fs.length) out += `<text class="area s" x="${x + 16}" y="${y + HEAD + 24}" fill="currentColor" style="fill:var(--text2);font-size:12px">Nothing defined yet</text>`;
      b.fs.forEach((f, i) => { out += nodeSvg(f, x + (AW - NW) / 2, y + HEAD + i * CH, false); });
    });
    y += rh + GAP;
  });
  const W = COLS * AW + (COLS - 1) * GAP, H = y - GAP;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Overview of all areas and features">${defs()}${out}</svg>`;
}
function areaSvg(area, feats) {
  const mine = feats.filter(f => f.area === area.id);
  const ids = new Set(mine.map(f => f.id));
  const ghosts = new Map();
  feats.forEach(f => {
    if (ids.has(f.id)) return;
    const touches = f.depends_on.some(d => ids.has(d)) || mine.some(m => m.depends_on.includes(f.id));
    if (touches) ghosts.set(f.id, f);
  });
  const all = [...mine, ...ghosts.values()];
  const byId = new Map(all.map(f => [f.id, f]));
  const memo = new Map();
  const level = id => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, 0);
    const ds = byId.get(id).depends_on.filter(d => byId.has(d));
    const l = ds.length ? 1 + Math.max(...ds.map(level)) : 0;
    memo.set(id, l); return l;
  };
  all.forEach(f => level(f.id));
  const cols = [];
  all.sort((a, b) => a.name.localeCompare(b.name)).forEach(f => { (cols[memo.get(f.id)] = cols[memo.get(f.id)] || []).push(f); });
  const CW = NW + 70, RH = NH + 26, pos = new Map();
  const maxRows = Math.max(...cols.map(c => (c || []).length), 1);
  cols.forEach((c, ci) => (c || []).forEach((f, ri) => {
    const off = (maxRows - c.length) * RH / 2;
    pos.set(f.id, { x: ci * CW, y: off + ri * RH });
  }));
  let edges = "", nodes = "";
  all.forEach(f => f.depends_on.forEach(d => {
    if (!pos.has(d)) return;
    const a = pos.get(d), b = pos.get(f.id);
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = (x2 - x1) / 2;
    edges += `<path class="edge" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2 - 2} ${y2}" marker-end="url(#arr)"/>`;
  }));
  all.forEach(f => {
    const p = pos.get(f.id), isGhost = !ids.has(f.id);
    const an = isGhost ? (feats.length && areaName(f.area)) : "";
    nodes += nodeSvg(f, p.x, p.y, isGhost, an);
  });
  const W = Math.max(cols.length, 1) * CW - 70, H = maxRows * RH - 26;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Features of ${esc(area.name)} and how they depend on each other">${defs()}${edges}${nodes}</svg>`;
}
let AREA_NAMES = {};
const areaName = id => AREA_NAMES[id] || id;

// ---------- pages ----------
const LEGEND = `<div class="legend"><span>Live</span><span class="planned">Planned</span><span class="paused">Paused</span><span class="ghost">Belongs to another area</span></div>`;

async function pageManualOverview() {
  const { areas, feats } = await loadRegistry();
  AREA_NAMES = Object.fromEntries(areas.map(a => [a.id, a.name]));
  const live = feats.filter(f => f.status === "live").length;
  view.innerHTML = `<div class="label">Manual</div><h1>How the system fits together</h1>
    <p class="muted">${feats.length} features in ${areas.length} areas, ${live} of them live. This page is generated from the registry, so it always matches what exists. Click an area or a feature to open it.</p>
    <div class="diagram">${overviewSvg(areas, feats)}</div>${LEGEND}
    <h2>Areas</h2><div class="grid">${areas.map(a => `<div class="card"><h3><a href="#/manual/${esc(a.id)}">${esc(a.name)}</a></h3><p class="muted" style="margin:0">${esc(a.summary)}</p></div>`).join("")}</div>`;
}
async function pageManualArea(areaId, featureId) {
  const [{ areas, feats }, hist] = await Promise.all([loadRegistry(), loadHistory()]);
  AREA_NAMES = Object.fromEntries(areas.map(a => [a.id, a.name]));
  const area = areas.find(a => a.id === areaId);
  if (!area) { view.innerHTML = `<div class="notice err">No area called "${esc(areaId)}". <a href="#/manual">Back to the overview</a></div>`; return; }
  const mine = feats.filter(f => f.area === areaId).sort((a, b) => a.name.localeCompare(b.name));
  const link = id => { const f = feats.find(x => x.id === id); return f ? `<a href="#/manual/${esc(f.area)}/${esc(f.id)}">${esc(f.name)}</a>` : esc(id); };
  const list = v => Array.isArray(v) ? v.map(esc).join(", ") : esc(v);
  const impl = o => Object.entries(o || {}).map(([k, v]) => `${esc(k.replace(/_/g, " "))}: ${list(v)}`).join("<br>");
  const section = f => {
    const rows = [
      ["Trigger", esc(f.trigger)],
      ["Reads", f.reads.length ? list(f.reads) : "—"],
      ["Writes", f.writes.length ? list(f.writes) : "—"],
      ["Depends on", f.depends_on.length ? f.depends_on.map(link).join(", ") : "—"],
      ["Needed by", feats.filter(x => x.depends_on.includes(f.id)).map(x => link(x.id)).join(", ") || "—"],
      ["Implemented by", Object.keys(f.implemented_by || {}).length ? impl(f.implemented_by) : "not built yet"],
      ["Rules and settings", f.config ? esc(f.config) : "—"],
      ["How to test", esc(f.test)]
    ];
    if (f.note) rows.push(["Note", esc(f.note)]);
    const h = hist.filter(x => x.feature === f.id);
    if (h.length) rows.push(["History", `<ul class="history">${h.map(x => `<li>${esc(x.date)}: ${esc(x.change)}</li>`).join("")}</ul>`]);
    const pill = f.status === "live" ? "ok" : f.status === "paused" ? "stale" : "none";
    return `<section class="card feature" id="f-${esc(f.id)}"><div class="head"><div><div class="label">${esc(KIND[f.kind] || f.kind)}</div><h3>${esc(f.name)}</h3></div><span class="pill ${pill}">${esc(f.status)}</span></div>
      <p style="margin:6px 0 0">${esc(f.summary)}</p><table class="kv">${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</table></section>`;
  };
  view.innerHTML = `<div class="crumbs"><a href="#/manual">Manual</a> / ${esc(area.name)}</div><h1>${esc(area.name)}</h1><p class="muted">${esc(area.summary)}</p>
    ${mine.length ? `<div class="diagram">${areaSvg(area, feats)}</div>${LEGEND}<p class="muted" style="font-size:14px">An arrow means the feature on the left is needed by the one on the right.</p>
    <h2>Features</h2>${mine.map(section).join("")}` : `<div class="notice">Nothing is defined for this area yet.</div>`}`;
  if (featureId) { const el = document.getElementById("f-" + featureId); if (el) el.scrollIntoView(); }
}
async function pageDashboard() {
  const [{ areas, feats }, statusTxt] = await Promise.all([loadRegistry(), gh("status.json").catch(e => { if (String(e.message).startsWith("MISSING|")) return "{}"; throw e; })]);
  const status = (JSON.parse(statusTxt || "{}").jobs) || {};
  const jobs = feats.filter(f => f.kind === "nightly-job" || f.kind === "weekly-job").sort((a, b) => a.name.localeCompare(b.name));
  const now = Date.now();
  const when = iso => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Warsaw", dateStyle: "medium", timeStyle: "short" });
  const row = f => {
    const s = status[f.id];
    let pill = `<span class="pill none">no report yet</span>`, extra = "";
    if (f.status !== "live") pill = `<span class="pill none">not built</span>`;
    else if (s) {
      const limit = (f.kind === "weekly-job" ? 9 * 24 : 36) * 3600e3;
      const stale = !s.finished || now - new Date(s.finished).getTime() > limit;
      if (s.state === "fail") pill = `<span class="pill fail">FAILED</span>`;
      else if (stale) pill = `<span class="pill stale">no recent run</span>`;
      else pill = `<span class="pill ok">OK</span>`;
      extra = `<div class="muted" style="font-size:13px">${s.finished ? esc(when(s.finished)) : ""}${s.message ? " · " + esc(s.message) : ""}</div>`;
    }
    return `<div class="row"><div><a href="#/manual/${esc(f.area)}/${esc(f.id)}">${esc(f.name)}</a>${extra}</div>${pill}</div>`;
  };
  const soon = n => `<p class="muted" style="margin:0">Not built yet. ${esc(n)}</p>`;
  view.innerHTML = `<div class="label">Dashboard</div><h1>Today</h1>
    <div class="grid">
      <div class="card"><div class="label">System status</div>${jobs.length ? jobs.map(row).join("") : soon("")}</div>
      <div class="card"><div class="label">Today’s agenda</div>${soon("Planning area.")}</div>
      <div class="card"><div class="label">Next seven days</div>${soon("Planning area.")}</div>
      <div class="card"><div class="label">Projects</div>${soon("Projects area.")}</div>
      <div class="card"><div class="label">English report</div>${soon("Study area.")}</div>
    </div>`;
}
function pageSettings() {
  const has = !!getToken();
  view.innerHTML = `<div class="label">Settings</div><h1>Access to your data</h1>
    <p class="muted">The page itself is public and holds no personal data. Your data sits in the private repository ${esc(DATA_REPO)} and is read with a token that stays in this browser only.</p>
    <div class="card"><div class="label">GitHub token</div>
      <p class="muted">Create a fine-grained token on GitHub for the repository ${esc(DATA_REPO)} only, with the Contents permission (read is enough for now), and paste it here.</p>
      <input type="password" id="tok" placeholder="${has ? "A token is saved. Paste a new one to replace it." : "Paste token"}" autocomplete="off">
      <p style="margin-top:14px"><button id="save">Save and test</button> <button class="sec" id="clear">Remove token</button></p>
      <div id="msg"></div></div>`;
  document.getElementById("save").onclick = async () => {
    const v = document.getElementById("tok").value.trim(); if (v) setToken(v);
    const m = document.getElementById("msg");
    try { await gh("registry/areas.json"); m.innerHTML = `<div class="notice">Works. <a href="#/">Open the dashboard</a></div>`; } catch (e) { m.innerHTML = problem(e); }
  };
  document.getElementById("clear").onclick = () => { setToken(""); pageSettings(); };
}

// ---------- router ----------
async function route() {
  const parts = (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.dataset.nav === (parts[0] || "dashboard")));
  view.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    if (parts[0] === "settings") pageSettings();
    else if (parts[0] === "manual" && parts[1]) await pageManualArea(parts[1], parts[2]);
    else if (parts[0] === "manual") await pageManualOverview();
    else await pageDashboard();
  } catch (e) { view.innerHTML = problem(e); }
  if (!(parts[0] === "manual" && parts[2])) window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
route();
