// Token Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a live-token view set apart from it, filters, sortable columns, a
// per-protocol detail panel with the model's factors and the farm plan, and a small sandbox
// that re-ranks the board under other model constants. No network: every byte is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var DEFAULTS = { growth_weight: DATA.model.growth_weight, maturity_span: DATA.model.maturity_span, breadth_per_chain: DATA.model.breadth_per_chain };
  var state = {
    tab: 'board', q: '', category: 'all', chain: 'all', sort: 'implied', dir: -1,
    selected: null, sand: { growth_weight: DEFAULTS.growth_weight, maturity_span: DEFAULTS.maturity_span, breadth_per_chain: DEFAULTS.breadth_per_chain },
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUSD(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function fmtFull(n) {
    return n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(v) {
    if (v == null) return '<span class="flat">—</span>';
    var cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function fmtAge(days) {
    if (days == null) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }
  function sandboxDirty() {
    return state.sand.growth_weight !== DEFAULTS.growth_weight || state.sand.maturity_span !== DEFAULTS.maturity_span || state.sand.breadth_per_chain !== DEFAULTS.breadth_per_chain;
  }
  // One row's implied value under the sandbox constants: the model's own formula, re-run in the
  // page from the row's stated inputs, so a reader can test how much of a rank is the model.
  function sandboxValue(r) {
    var m = DATA.model;
    var growth = Math.max(m.growth_mult_floor, 1 + (r.growth_pct / 100) * state.sand.growth_weight);
    var age = r.age_days == null ? m.unknown_age_days : r.age_days;
    var maturity = m.maturity_floor + state.sand.maturity_span * (Math.log(1 + Math.max(0, age)) / Math.log(1 + m.full_age_days));
    var extra = Math.min(Math.max(r.chains.length - 1, 0), m.breadth_max_extra);
    var breadth = 1 + state.sand.breadth_per_chain * extra;
    return Math.max(1, Math.round(r.tvl_usd * r.base_multiple * growth * maturity * breadth));
  }
  function valueOf(r) {
    return sandboxDirty() ? sandboxValue(r) : r.implied_value_usd;
  }

  function renderHead() {
    var top = DATA.rows[0];
    var stats = [
      ['Protocols scanned', String(DATA.protocol_size)],
      ['Watchlist covered', DATA.watchlist_size + ' <em>/ ' + DATA.watchlist_size + '</em>'],
      ['Board rows', DATA.board_size + ' <em>(' + DATA.early_size + ' early)</em>'],
      ['Live tokens aside', String(DATA.live_size)],
      ['Top implied value', top ? esc(fmtUSD(top.implied_value_usd)) : '—'],
    ];
    return (
      '<header class="masthead"><div>' +
      '<h1>Token <span class="scope">Launch</span> Radar</h1>' +
      '<p class="tagline">Pre-token protocols ranked by the value a launch could carry if their record stayed as it is — ' +
      'and a costed farm plan for every row. Protocols whose token already trades are set apart, at the market\u2019s own values.</p></div>' +
      '<div class="meta"><span class="model-chip">model ' + esc(DATA.model_version) + '</span><br>' +
      'Snapshot as of ' + esc(DATA.as_of) + '<br>' + esc(DATA.source) + '</div></header>' +
      '<section class="stats">' +
      stats.map(function (s) { return '<div class="stat"><div class="k">' + s[0] + '</div><div class="v">' + s[1] + '</div></div>'; }).join('') +
      '</section>'
    );
  }

  function options(values, all) {
    return '<option value="all">' + all + '</option>' + values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
  }

  function renderControls() {
    var cats = {};
    var chains = {};
    DATA.rows.forEach(function (r) {
      if (r.category) cats[r.category] = (cats[r.category] || 0) + 1;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    var catList = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a] || (a < b ? -1 : 1); });
    var chainList = Object.keys(chains).sort();
    return (
      '<div class="controls">' +
      '<span class="tabs" role="group" aria-label="View">' +
      '<button type="button" data-tab="board" aria-pressed="' + (state.tab === 'board') + '">Pre-token board</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live tokens</button></span>' +
      '<label>Search <input type="search" id="q" placeholder="name or slug" value="' + esc(state.q) + '"></label>' +
      '<label>Category <select id="f-category">' + options(catList, 'All categories') + '</select></label>' +
      '<label>Chain <select id="f-chain">' + options(chainList, 'All chains') + '</select></label>' +
      '<label>Sort <select id="f-sort">' +
      '<option value="implied">Implied value</option><option value="tvl">TVL</option>' +
      '<option value="growth">7d change</option><option value="age">Age</option><option value="name">Name</option>' +
      '</select></label>' +
      '<span class="count" id="count"></span></div>'
    );
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = valueOf(a); vb = valueOf(b); }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d == null ? -Infinity : a.change_7d; vb = b.change_7d == null ? -Infinity : b.change_7d; }
      else if (key === 'age') { va = a.age_days == null ? -1 : a.age_days; vb = b.age_days == null ? -1 : b.age_days; }
      else { return dir * (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0); }
      if (va !== vb) return dir * (va < vb ? -1 : 1);
      return a.rank - b.rank;
    });
    return rows;
  }

  function boardTable(rows) {
    if (rows.length === 0) return '<div class="panel empty">No protocol matches this view. Loosen the search or the filters.</div>';
    var head =
      '<thead><tr><th data-sort="implied">#</th><th data-sort="name">Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num" data-sort="tvl">TVL</th><th class="num" data-sort="growth">7d</th><th class="num" data-sort="age">Age</th>' +
      '<th class="num" data-sort="implied">Implied value</th><th class="num">FDV / TVL</th></tr></thead>';
    var body = rows.map(function (r, i) {
      var shownRank = sandboxDirty() && state.sort === 'implied' ? i + 1 : r.rank;
      return (
        '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="rank">' + shownRank + '</td>' +
        '<td class="proto"><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + (r.category ? '<span class="chip">' + esc(r.category) + '</span>' : '<span class="flat">—</span>') +
        (r.on_watchlist ? ' <span class="chip watch">watchlist</span>' : '') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + fmtUSD(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num"><strong>' + fmtUSD(valueOf(r)) + '</strong></td>' +
        '<td class="num">' + (valueOf(r) / r.tvl_usd).toFixed(2) + 'x</td></tr>'
      );
    }).join('');
    return '<div class="panel table-wrap"><table>' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  function liveTable() {
    var head = '<thead><tr><th>#</th><th>Protocol</th><th>Symbol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead>';
    var body = DATA.live.map(function (r, i) {
      return (
        '<tr><td class="rank">' + (i + 1) + '</td>' +
        '<td class="proto"><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + (r.symbol ? '<span class="chip">' + esc(r.symbol) + '</span>' : '—') + '</td>' +
        '<td>' + (r.category ? esc(r.category) : '—') + '</td>' +
        '<td class="num">' + fmtUSD(r.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + fmtUSD(r.mcap_usd) + '</strong></td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td></tr>'
      );
    }).join('');
    return '<div class="panel table-wrap"><table>' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  function detailPanel() {
    var r = null;
    DATA.rows.forEach(function (row) { if (row.slug === state.selected) r = row; });
    if (!r) return '';
    var v = valueOf(r);
    var factors = [
      ['TVL (snapshot)', fmtFull(r.tvl_usd), 'the record the value rests on'],
      ['Base multiple', 'x ' + r.base_multiple.toFixed(2), esc(r.category || 'uncategorised') + ' family'],
      ['Growth', 'x ' + r.growth_multiplier.toFixed(3), (r.growth_pct > 0 ? '+' : '') + r.growth_pct.toFixed(1) + '% over 7 days, clamped'],
      ['Maturity', 'x ' + r.maturity_multiplier.toFixed(3), fmtAge(r.age_days) + ' with no token'],
      ['Breadth', 'x ' + r.breadth_multiplier.toFixed(3), r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + ' spanned'],
      ['Implied value', fmtFull(v), (v / r.tvl_usd).toFixed(2) + 'x its TVL'],
    ];
    return (
      '<aside class="panel detail"><h2>' + esc(r.name) + '</h2>' +
      '<div class="sub">Rank #' + r.rank + ' of ' + DATA.board_size + (r.on_watchlist ? ' · on the snapshot watchlist' : ' · early, below the watchlist floor') + '</div>' +
      '<div class="big">' + fmtFull(v) + ' <small>implied launch value</small></div>' +
      '<table class="factors"><tbody>' +
      factors.map(function (f) { return '<tr><td>' + f[0] + '<br><span class="why">' + f[2] + '</span></td><td class="num">' + f[1] + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<h3>Farm plan</h3><ol class="farm">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>' +
      '<h3>The record</h3><dl class="record">' +
      '<dt>Slug</dt><dd>' + esc(r.slug) + '</dd>' +
      '<dt>Tracked since</dt><dd>' + esc(r.listed_at || 'not reported') + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || 'none named') + '</dd>' +
      '<dt>7d TVL change</dt><dd>' + (r.change_7d == null ? 'not reported' : r.change_7d.toFixed(2) + '%') + '</dd>' +
      '<dt>Token</dt><dd>records no token</dd></dl></aside>'
    );
  }

  function modelCard() {
    var m = DATA.model;
    return (
      '<section class="panel model-card"><h2>How the model works</h2>' +
      '<p><code>implied = TVL x base(category) x growth x maturity x breadth</code> — every figure from the snapshot itself; ' +
      'no protocol\u2019s name is read by the formula. The base multiple runs from 0.14 for risk curators and allocators to 0.32 for ' +
      'derivatives venues, because the same TVL supports very different fee bases. Growth clamps the 7-day change to ' +
      '[' + m.growth_floor_pct + '%, +' + m.growth_cap_pct + '%] and weights it ' + m.growth_weight + '. Maturity log-scales the days since ' +
      'DefiLlama began tracking the protocol, full weight at ' + m.full_age_days + ' days. Breadth adds ' + (m.breadth_per_chain * 100).toFixed(0) +
      '% per extra chain, up to ' + m.breadth_max_extra + '. Every row of the board states its own factors in its detail view.</p>' +
      '<p>The board is the model\u2019s claim, not a prediction that a token will be issued. The watchlist is a floor: all ' +
      DATA.watchlist_size + ' of its protocols are ranked, and the ' + DATA.early_size + ' early rows below its $' +
      (DATA.floor_usd / 1e6).toFixed(0) + 'M line were chosen by the same formula.</p>' +
      '<div class="sandbox"><strong>Sandbox</strong>' +
      '<label>Growth weight <input type="range" id="s-growth" min="0" max="1" step="0.05" value="' + state.sand.growth_weight + '"><output>' + state.sand.growth_weight.toFixed(2) + '</output></label>' +
      '<label>Maturity span <input type="range" id="s-maturity" min="0" max="0.9" step="0.05" value="' + state.sand.maturity_span + '"><output>' + state.sand.maturity_span.toFixed(2) + '</output></label>' +
      '<label>Breadth / chain <input type="range" id="s-breadth" min="0" max="0.1" step="0.01" value="' + state.sand.breadth_per_chain + '"><output>' + state.sand.breadth_per_chain.toFixed(2) + '</output></label>' +
      '<button type="button" id="s-reset">Reset to the stated model</button>' +
      (sandboxDirty() ? '<span class="chip watch">sandbox ranking — the handed-in board uses the stated constants</span>' : '') +
      '</div></section>' +
      '<p class="foot">Data: ' + esc(DATA.source) + '. The board\u2019s implied values are this entry\u2019s own claims, derived as stated; ' +
      'a protocol is said to record no token, never to have none — its DefiLlama record is the whole of the evidence.</p>'
    );
  }

  function render() {
    var html = renderHead() + renderControls();
    if (state.tab === 'live') {
      html += '<div class="stage no-detail">' + liveTable() + '</div>';
    } else {
      var rows = visibleRows();
      var detail = detailPanel();
      html += '<div class="stage' + (detail ? '' : ' no-detail') + '">' + boardTable(rows) + detail + '</div>';
    }
    html += modelCard();
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
    wire(rows);
  }

  function wire(rows) {
    var count = document.getElementById('count');
    if (count) {
      count.textContent = state.tab === 'live'
        ? DATA.live.length + ' live-token protocols, set apart'
        : 'Showing ' + rows.length + ' of ' + DATA.rows.length + ' rows' + (sandboxDirty() ? ' · sandbox values' : '');
    }
    var cat = document.getElementById('f-category');
    var chain = document.getElementById('f-chain');
    var sort = document.getElementById('f-sort');
    if (cat) cat.value = state.category;
    if (chain) chain.value = state.chain;
    if (sort) sort.value = state.sort;
    app.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); render(); });
    });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; refreshTable(); });
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; refreshTable(); });
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; refreshTable(); });
    if (sort) sort.addEventListener('change', function () { state.sort = sort.value; state.dir = sort.value === 'name' ? 1 : -1; refreshTable(); });
    bindTable();
    bindSandbox();
  }

  // Re-render only the stage, keeping the controls (and the search box's focus) as they are.
  function refreshTable() {
    var stage = app.querySelector('.stage');
    if (!stage) { render(); return; }
    if (state.tab === 'live') { stage.innerHTML = liveTable(); return; }
    var rows = visibleRows();
    var detail = detailPanel();
    stage.className = 'stage' + (detail ? '' : ' no-detail');
    stage.innerHTML = boardTable(rows) + detail;
    var count = document.getElementById('count');
    if (count) count.textContent = 'Showing ' + rows.length + ' of ' + DATA.rows.length + ' rows' + (sandboxDirty() ? ' · sandbox values' : '');
    bindTable();
  }

  function bindTable() {
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.selected = state.selected === tr.getAttribute('data-slug') ? null : tr.getAttribute('data-slug');
        refreshTable();
      });
    });
    app.querySelectorAll('thead th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
        var sort = document.getElementById('f-sort');
        if (sort && sort.querySelector('option[value="' + k + '"]')) sort.value = k;
        refreshTable();
      });
    });
  }

  function bindSandbox() {
    function bind(id, key, fmt) {
      var input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('input', function () {
        state.sand[key] = parseFloat(input.value);
        input.nextElementSibling.textContent = fmt(state.sand[key]);
        refreshTable();
        var card = app.querySelector('.model-card .sandbox');
        if (card && sandboxDirty() && !card.querySelector('.chip.watch')) render();
      });
    }
    bind('s-growth', 'growth_weight', function (v) { return v.toFixed(2); });
    bind('s-maturity', 'maturity_span', function (v) { return v.toFixed(2); });
    bind('s-breadth', 'breadth_per_chain', function (v) { return v.toFixed(2); });
    var reset = document.getElementById('s-reset');
    if (reset) reset.addEventListener('click', function () {
      state.sand = { growth_weight: DEFAULTS.growth_weight, maturity_span: DEFAULTS.maturity_span, breadth_per_chain: DEFAULTS.breadth_per_chain };
      render();
    });
  }

  render();
})();
