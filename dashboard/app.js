// Token Launch Radar — dashboard logic. Reads window.RADAR (written by main.ts
// from the sealed snapshot): the ranked board, the live view, and the model.
// No network: everything renders from that one data file.
(function () {
  var D = window.RADAR || { rows: [], live: [] };
  var rows = D.rows || [];
  var live = D.live || [];
  var state = { q: "", cat: "", chain: "", sort: "rank", view: "board" };

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n === null || n === undefined) return "—";
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function pct(c) {
    if (c === null || c === undefined) return "—";
    var s = (c > 0 ? "+" : "") + c.toFixed(1) + "%";
    return '<span class="' + (c >= 0 ? "up" : "down") + '">' + s + "</span>";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- filter + sort -------------------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
    }[state.sort];
    return list.sort(by);
  }

  function renderBoard() {
    var list = filtered();
    var html = list.map(function (r) {
      return "<tr data-slug=\"" + esc(r.slug) + "\"><td>" + r.rank + "</td>" +
        "<td><strong>" + esc(r.name) + "</strong><br><span class=\"sub\">" + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + esc(r.chains.slice(0, 3).join(", ")) + (r.chains.length > 3 ? " +" + (r.chains.length - 3) : "") + "</td>" +
        "<td class=\"num\">" + money(r.tvl_usd) + "</td>" +
        "<td class=\"num\">" + pct(r.change_7d) + "</td>" +
        "<td class=\"num val\">" + money(r.implied_value_usd) + "</td></tr>";
    }).join("");
    $("rows").innerHTML = html || '<tr><td colspan="7">No protocols match this filter.</td></tr>';
    $("count").textContent = list.length + " of " + rows.length + " ranked protocols";
    var tbody = $("rows");
    var trs = tbody.getElementsByTagName("tr");
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener("click", function () {
        showDetail(this.getAttribute("data-slug"));
      });
    }
  }

  function renderLive() {
    $("live-rows").innerHTML = live.map(function (p) {
      var ratio = p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + "x" : "—";
      return "<tr><td><strong>" + esc(p.name) + "</strong></td>" +
        "<td>" + esc(p.symbol || "—") + "</td>" +
        "<td>" + esc(p.category || "—") + "</td>" +
        "<td class=\"num\">" + money(p.tvl_usd) + "</td>" +
        "<td class=\"num val\">" + money(p.mcap_usd) + "</td>" +
        "<td class=\"num\">" + ratio + "</td></tr>";
    }).join("");
  }

  // ---- detail view ---------------------------------------------------------
  function bar(label, value, max, text) {
    var w = Math.max(2, Math.min(100, (value / max) * 100));
    return '<div class="bar-row"><span>' + label + '</span>' +
      '<span class="bar"><i style="width:' + w.toFixed(0) + '%"></i></span>' +
      "<span><strong>" + text + "</strong></span></div>";
  }

  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return;
    var b = r.breakdown;
    $("d-name").textContent = "#" + r.rank + " " + r.name;
    $("d-sub").textContent = r.slug + " · " + (r.category || "uncategorised") + " · " +
      r.chains.join(", ") + " · snapshot " + D.as_of;
    $("d-stats").innerHTML =
      '<div class="stat"><b>' + money(r.implied_value_usd) + '</b><span>Implied value</span></div>' +
      '<div class="stat"><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="stat"><b>' + (r.change_7d === null ? "—" : (r.change_7d > 0 ? "+" : "") + r.change_7d.toFixed(1) + "%") + '</b><span>TVL change 7d</span></div>' +
      '<div class="stat"><b>' + (r.age_days === null ? "—" : r.age_days + " days") + '</b><span>Tracked, no token</span></div>';
    $("d-model").innerHTML =
      bar("Category multiple", b.multiple, 1.25, b.multiple.toFixed(2) + "x (" + b.peers + " tokened peer" + (b.peers === 1 ? "" : "s") + ")") +
      bar("Momentum (7d)", b.momentum, 2.5, b.momentum.toFixed(2) + "x") +
      bar("Maturity", b.maturity, 1.0, b.maturity.toFixed(2) + "x") +
      bar("Chain breadth", b.breadth, 1.1, b.breadth.toFixed(2) + "x") +
      '<p class="sub">implied = ' + money(r.tvl_usd) + ' &times; ' + b.multiple.toFixed(2) +
      ' &times; ' + b.momentum.toFixed(2) + ' &times; ' + b.maturity.toFixed(2) +
      ' &times; ' + b.breadth.toFixed(2) + ' = <strong>' + money(r.implied_value_usd) + '</strong></p>';
    $("d-steps").innerHTML = r.farm_steps.map(function (s) {
      return "<li>" + esc(s) + "</li>";
    }).join("");
    $("detail").hidden = false;
    $("detail").scrollIntoView();
  }

  // ---- wiring --------------------------------------------------------------
  function fillSelect(id, values) {
    var sel = $(id);
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v; o.textContent = v; sel.appendChild(o);
    });
  }
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  fillSelect("cat", cats.sort());
  fillSelect("chain", chains.sort());

  $("meta").textContent = "Snapshot " + D.as_of + " · " + rows.length +
    " ranked protocols (" + (D.watchlist_count || 0) + " on the watchlist) · " +
    live.length + " already live.";
  $("q").addEventListener("input", function () { state.q = this.value; renderBoard(); });
  $("cat").addEventListener("change", function () { state.cat = this.value; renderBoard(); });
  $("chain").addEventListener("change", function () { state.chain = this.value; renderBoard(); });
  $("sort").addEventListener("change", function () { state.sort = this.value; renderBoard(); });
  $("detail-close").addEventListener("click", function () {
    $("detail").hidden = true;
    $("board-view").scrollIntoView();
  });
  function setView(v) {
    state.view = v;
    $("view-board").classList.toggle("active", v === "board");
    $("view-live").classList.toggle("active", v === "live");
    $("board-view").hidden = v !== "board";
    $("live-view").hidden = v !== "live";
    if (v === "live") renderLive();
  }
  $("view-board").addEventListener("click", function () { setView("board"); });
  $("view-live").addEventListener("click", function () { setView("live"); });

  renderBoard();
})();
