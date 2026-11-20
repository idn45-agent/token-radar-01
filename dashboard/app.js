// Token Launch Radar v3 — dashboard logic. Reads window.RADAR (written by
// main.ts from the sealed snapshot): the ranked board with its evidence,
// the live (already-tokened) view and the fitted calibration. No network:
// everything renders from that one data file.
"use strict";

const R = window.RADAR || { meta: {}, rows: [], live: [] };
const META = R.meta || {};
const ROWS = R.rows || [];
const bySlug = new Map(ROWS.map((r) => [r.slug, r]));

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

function money(x) {
  return "$" + Math.round(x).toLocaleString("en-US");
}
function compact(x) {
  if (x >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
  if (x >= 1e6) return "$" + (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
  return "$" + Math.round(x);
}
function pct(x) {
  if (x === null || x === undefined) return '<span class="na">—</span>';
  const cls = x > 0 ? "up" : x < 0 ? "down" : "";
  return `<span class="${cls}">${x > 0 ? "+" : ""}${x.toFixed(1)}%</span>`;
}
function ageText(days) {
  if (days === null || days === undefined) return '<span class="na">unknown</span>';
  if (days >= 730) return (days / 365.25).toFixed(1) + " yrs";
  if (days >= 60) return Math.round(days / 30.4) + " mo";
  return days + " d";
}
function fx(x) {
  return "×" + Number(x).toFixed(2);
}

// Range bars share one log scale across the whole board, so a $1M protocol
// and a $500M protocol can be read off the same axis.
const allLow = Math.min(...ROWS.map((r) => r.value_low_usd));
const allHigh = Math.max(...ROWS.map((r) => r.value_high_usd));
const logLo = Math.log10(Math.max(1, allLow));
const logHi = Math.log10(Math.max(10, allHigh));
function logPos(x) {
  return ((Math.log10(Math.max(1, x)) - logLo) / (logHi - logLo)) * 100;
}
function rangeBar(r) {
  const left = logPos(r.value_low_usd);
  const width = Math.max(2, logPos(r.value_high_usd) - left);
  const mark = logPos(r.implied_value_usd);
  return (
    `<span class="rangebar"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></i>` +
    `<b style="left:calc(${mark.toFixed(1)}% - 1px)"></b></span>` +
    `<span class="rangetxt">${compact(r.value_low_usd)} – ${compact(r.value_high_usd)}</span>`
  );
}
function confBar(r) {
  return (
    `<span class="confbar"><i style="width:${r.confidence}%"></i></span>` +
    `<span class="conftxt">${r.confidence}</span>`
  );
}

// ---------------------------------------------------------------- header
$("m-asof").textContent = META.as_of || "—";
$("s-scanned").textContent = META.protocols_scanned ?? "—";
$("s-tracked").textContent = META.pretoken_tracked ?? "—";
$("s-watch").textContent =
  META.watchlist_covered !== undefined
    ? `${META.watchlist_covered} / ${META.watchlist_total}`
    : "—";
$("s-agg").textContent = META.aggregate_implied_usd ? compact(META.aggregate_implied_usd) : "—";
$("s-med").textContent = META.median_multiple ? "×" + META.median_multiple.toFixed(2) : "—";
$("m-global").textContent = META.global_median_multiple
  ? "×" + META.global_median_multiple.toFixed(3)
  : "—";
$("m-slope").textContent = META.size_slope ?? "—";

// -------------------------------------------------------------- controls
const catSel = $("f-cat");
for (const c of META.categories || []) {
  const o = document.createElement("option");
  o.value = c.name;
  o.textContent = c.name;
  catSel.appendChild(o);
}
const chainSel = $("f-chain");
for (const c of META.chains || []) {
  const o = document.createElement("option");
  o.value = c;
  o.textContent = c;
  chainSel.appendChild(o);
}

const state = { seg: "all", q: "", cat: "", chain: "", mom: "", sort: "rank" };

function filtered() {
  let out = ROWS.filter((r) => {
    if (state.seg === "watch" && !r.watchlist) return false;
    if (state.seg === "early" && r.tvl_usd >= (META.floor_usd || 50000000)) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.mom === "up" && !(r.change_7d > 0)) return false;
    if (state.mom === "down" && !(r.change_7d < 0)) return false;
    if (state.mom === "na" && r.change_7d !== null) return false;
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    }
    return true;
  });
  const by = {
    rank: (a, b) => a.rank - b.rank,
    value: (a, b) => b.implied_value_usd - a.implied_value_usd,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    chg: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    conf: (a, b) => b.confidence - a.confidence,
  };
  out.sort(by[state.sort] || by.rank);
  return out;
}

function rowHtml(r) {
  const meta = [r.category || "Uncategorised", r.chains.slice(0, 3).join(" · ")].join(" — ");
  return (
    `<tr data-slug="${esc(r.slug)}">` +
    `<td class="rank num">${r.rank}</td>` +
    `<td><span class="pname">${esc(r.name)}</span>` +
    (r.watchlist ? '<span class="badge">Watchlist</span>' : "") +
    `<span class="pmeta">${esc(meta)}</span></td>` +
    `<td class="n">${compact(r.tvl_usd)}</td>` +
    `<td class="n">${pct(r.change_7d)}</td>` +
    `<td class="n">${ageText(r.age_days)}</td>` +
    `<td class="n val">${compact(r.implied_value_usd)}</td>` +
    `<td>${rangeBar(r)}</td>` +
    `<td>${confBar(r)}</td></tr>`
  );
}

function renderBoard() {
  const rows = filtered();
  $("rows").innerHTML = rows.map(rowHtml).join("");
  $("count").textContent =
    `Showing ${rows.length} of ${ROWS.length} pre-token protocols` +
    (state.seg === "watch"
      ? ` — the full ${META.watchlist_total}-protocol watchlist is on the board`
      : "") +
    ". Click a row for its pricing detail and farm plan.";
}

function renderLive() {
  $("live-rows").innerHTML = (R.live || [])
    .map(
      (l) =>
        `<tr><td><span class="pname">${esc(l.name)}</span></td>` +
        `<td>${esc(l.symbol || "—")}</td>` +
        `<td class="n">${compact(l.mcap_usd)}</td>` +
        `<td class="n">${compact(l.tvl_usd)}</td>` +
        `<td class="n">×${l.multiple.toFixed(2)}</td></tr>`,
    )
    .join("");
}

// ---------------------------------------------------------------- detail
function factorRow(label, value, desc) {
  const w = Math.min(
    100,
    Math.max(2, ((Math.log(value) - Math.log(0.3)) / (Math.log(2.2) - Math.log(0.3))) * 100),
  );
  return (
    `<div class="frow"><span class="fl">${label}</span>` +
    `<span class="fbar"><i style="width:${w.toFixed(0)}%"></i></span>` +
    `<span class="fx">${fx(value)}</span>` +
    `<span class="fdesc">${desc}</span></div>`
  );
}

function showDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) return;
  const f = r.factors;
  const peerNote =
    r.peers.length > 0
      ? `${r.peers.length} largest tokened ${esc(r.category || "")} peers shown below`
      : "no tokened peers in this category — the global median carries the price";
  const momDesc =
    r.change_7d === null
      ? "7-day TVL change unreported: neutral ×1.00, and confidence is docked for the missing evidence."
      : `7-day TVL change of ${r.change_7d > 0 ? "+" : ""}${r.change_7d.toFixed(1)}% becomes ${fx(f.momentum)} at 0.85 weight.`;
  const ageDesc =
    r.age_days === null
      ? "Listing date unreported: a flat ×0.85 prior, and confidence is docked."
      : `Tracked for ${r.age_days} days with no token recorded: the maturity curve gives ${fx(f.maturity)}.`;
  const peersHtml =
    r.peers.length > 0
      ? `<table class="peers"><thead><tr><th>Tokened peer</th><th class="n">Market cap</th><th class="n">TVL</th><th class="n">mcap / TVL</th></tr></thead><tbody>` +
        r.peers
          .map(
            (p) =>
              `<tr><td>${esc(p.name)}</td><td class="n">${compact(p.mcap_usd)}</td>` +
              `<td class="n">${compact(p.tvl_usd)}</td><td class="n">×${p.multiple.toFixed(2)}</td></tr>`,
          )
          .join("") +
        `</tbody></table>`
      : `<p class="note">No tokened protocol in this category records a market cap, so the peer multiple is the global median itself.</p>`;
  const why =
    `${esc(r.name)} is priced at ×${r.multiple.toFixed(3)} of its ${compact(r.tvl_usd)} TVL: ` +
    `${esc(r.category || "its category")} peers support ${fx(f.peer_multiple)}, size adjusts that by ${fx(f.size_factor)}, ` +
    `momentum ${fx(f.momentum)} and maturity ${fx(f.maturity)}. It ranks #${r.rank} of ${ROWS.length} ` +
    `pre-token protocols, with confidence ${r.confidence}/100 — the range ${money(r.value_low_usd)} to ${money(r.value_high_usd)} is the honest width of that evidence.`;
  $("detail").innerHTML =
    `<div class="detail-head"><h2>${esc(r.name)}</h2>` +
    `<span class="chips">` +
    (r.watchlist ? '<span class="chip hot">Watchlist</span>' : "") +
    `<span class="chip">${esc(r.category || "Uncategorised")}</span>` +
    r.chains.map((c) => `<span class="chip">${esc(c)}</span>`).join("") +
    `</span></div>` +
    `<div class="detail-grid">` +
    `<div class="dstat"><span class="stat-v">${compact(r.tvl_usd)}</span><span class="stat-l">TVL</span></div>` +
    `<div class="dstat"><span class="stat-v">${r.change_7d === null ? "—" : (r.change_7d > 0 ? "+" : "") + r.change_7d.toFixed(1) + "%"}</span><span class="stat-l">TVL change, 7d</span></div>` +
    `<div class="dstat"><span class="stat-v">${r.age_days === null ? "unknown" : ageText(r.age_days)}</span><span class="stat-l">tracked, no token recorded</span></div>` +
    `<div class="dstat"><span class="stat-v">${r.confidence} / 100</span><span class="stat-l">confidence</span></div>` +
    `</div>` +
    `<div class="panel"><h3>Implied value if it launched at the fitted multiple</h3>` +
    `<span class="big-value">${money(r.implied_value_usd)}</span>` +
    `<p class="note">Range ${money(r.value_low_usd)} – ${money(r.value_high_usd)} at ×${r.multiple.toFixed(3)} of TVL. ` +
    `This is the board's model claim, recomputed from the snapshot — not a forecast.</p></div>` +
    `<div class="panel"><h3>How the price is built</h3>` +
    factorRow("Peer multiple", f.peer_multiple, `Median mcap/TVL of tokened ${esc(r.category || "")} protocols, winsorised and shrunk toward the global median — ${peerNote}.`) +
    factorRow("Size factor", f.size_factor, `The fitted size curve at ${compact(r.tvl_usd)} of TVL, relative to the $100M reference protocol (slope ${META.size_slope}).`) +
    factorRow("Momentum", f.momentum, momDesc) +
    factorRow("Maturity", f.maturity, ageDesc) +
    factorRow("Breadth", f.breadth, `Live on ${r.chains.length} chain${r.chains.length === 1 ? "" : "s"}: 1.5% per additional chain, capped at eight.`) +
    `<p class="why">${why}</p></div>` +
    `<div class="panel"><h3>Calibration peers</h3>${peersHtml}</div>` +
    `<div class="panel"><h3>Farm plan — 8 steps, costed</h3>` +
    `<ol class="plan">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`;
  $("board-view").hidden = true;
  $("live-view").hidden = true;
  $("detail-view").hidden = false;
  window.scrollTo(0, 0);
}

function showBoard() {
  $("detail-view").hidden = true;
  $("live-view").hidden = state.seg === "live" ? false : true;
  $("board-view").hidden = state.seg === "live";
}

// ---------------------------------------------------------------- events
document.querySelectorAll(".seg").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".seg").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    state.seg = b.dataset.seg;
    if (state.seg === "live") renderLive();
    showBoard();
    if (state.seg !== "live") renderBoard();
  });
});
$("f-q").addEventListener("input", (e) => { state.q = e.target.value.trim(); renderBoard(); });
catSel.addEventListener("change", (e) => { state.cat = e.target.value; renderBoard(); });
chainSel.addEventListener("change", (e) => { state.chain = e.target.value; renderBoard(); });
$("f-mom").addEventListener("change", (e) => { state.mom = e.target.value; renderBoard(); });
$("f-sort").addEventListener("change", (e) => { state.sort = e.target.value; renderBoard(); });
$("rows").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-slug]");
  if (tr) showDetail(tr.dataset.slug);
});
$("back").addEventListener("click", showBoard);

renderBoard();
