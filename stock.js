/* Stock page - hall-wise WIP pipeline + Production / Dispatch / Finished Goods.
   Data: GAS action "stockSummary" (hall master tabs se). */

state = {
  range: 'today', from: '', to: '', hall: '',
  data: null, open: null,
  loading: true, connected: true, pending: 0, statusMsg: ''
};

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function rangeDates() {
  var t = new Date(); t.setHours(0, 0, 0, 0);
  if (state.range === 'custom') return { from: state.from || ymd(t), to: state.to || ymd(t) };
  var f = new Date(t);
  if (state.range === 'week') f.setDate(f.getDate() - 6);
  if (state.range === 'month') f = new Date(t.getFullYear(), t.getMonth(), 1);
  return { from: ymd(f), to: ymd(t) };
}

/* ---------------- Load ---------------- */

function load() {
  var r = rangeDates();
  return call('stockSummary', { from: r.from, to: r.to }).then(function (res) {
    state.data = res; state.loading = false; state.statusMsg = '';
    if (!state.hall && res.halls && res.halls.length) state.hall = res.halls[0].hall;
    render();
  }, function (err) {
    state.loading = false; state.statusMsg = err.message; render();
  });
}

function setRange(r) { state.range = r; state.open = null; load(); }
function setFrom(v) { state.from = v; state.range = 'custom'; load(); }
function setTo(v) { state.to = v; state.range = 'custom'; load(); }
function setHall(h) { state.hall = h; state.open = null; render(); }
function openBox(k) { state.open = state.open === k ? null : k; render(); }

/* ---------------- Helpers ---------------- */

function halls() { return (state.data && state.data.halls) || []; }
function curHall() {
  var hs = halls();
  for (var i = 0; i < hs.length; i++) if (hs[i].hall === state.hall) return hs[i];
  return null;
}
function tot(models, f) { return models.reduce(function (a, m) { return a + f(m); }, 0); }
function stageCount(h, st) { return tot(h.models, function (m) { return m.wip[st] || 0; }); }

function statCards(models) {
  var card = function (n, l, cls) {
    return '<div class="stat-card ' + (cls || '') + '"><div class="num">' + n + '</div><div class="lbl">' + l + '</div></div>';
  };
  return '<div class="stat-grid">' +
    card(tot(models, function (m) { return m.wipTotal; }), 'WIP (abhi line pe)') +
    card(tot(models, function (m) { return m.prod; }), 'Production (is period)') +
    card(tot(models, function (m) { return m.disp; }), 'Dispatch (is period)') +
    card(tot(models, function (m) { return m.fg; }), 'Finished goods (abhi)', 'stock-fg') +
    '</div>';
}

/* ---------------- Render ---------------- */

function renderFilters() {
  var ranges = [['today', 'Aaj'], ['week', 'Last 7 din'], ['month', 'Is mahine'], ['custom', 'Custom']];
  var bar = '<div class="range-bar">' + ranges.map(function (r) {
    return '<button class="range-btn ' + (state.range === r[0] ? 'active' : '') + '" onclick="setRange(\'' + r[0] + '\')">' + r[1] + '</button>';
  }).join('') + '<button class="range-btn" onclick="load()">Refresh</button></div>';
  if (state.range === 'custom') {
    var r = rangeDates();
    bar += '<div class="row" style="max-width:420px;margin-bottom:14px;">' +
      '<div class="field"><label>From</label><input type="date" value="' + esc(r.from) + '" onchange="setFrom(this.value)"></div>' +
      '<div class="field"><label>To</label><input type="date" value="' + esc(r.to) + '" onchange="setTo(this.value)"></div></div>';
  }
  var tabs = halls().map(function (h) {
    return '<button class="range-btn ' + (state.hall === h.hall ? 'active' : '') + '" data-h="' + esc(h.hall) +
           '" onclick="setHall(this.dataset.h)">' + esc(h.hall) + '</button>';
  }).join('') + '<button class="range-btn ' + (state.hall === '__all' ? 'active' : '') + '" onclick="setHall(\'__all\')">Sab halls</button>';
  return bar + '<div class="range-bar">' + tabs + '</div>';
}

function renderPipeline(h) {
  var boxes = h.stages.map(function (st) {
    return { key: st, label: st, n: stageCount(h, st), cls: '' };
  });
  boxes.push({ key: '__fg', label: (h.prodStage || 'Production') + ' · FG', n: tot(h.models, function (m) { return m.fg; }), cls: 'fg' });
  boxes.push({ key: '__disp', label: (h.dispatchStage || 'Dispatch') + ' · period', n: tot(h.models, function (m) { return m.disp; }), cls: 'disp' });

  var html = boxes.map(function (b, i) {
    return (i ? '<div class="pipe-arrow">&rsaquo;</div>' : '') +
      '<button class="pipe-box ' + b.cls + (state.open === b.key ? ' on' : '') + (b.n ? '' : ' zero') +
      '" data-k="' + esc(b.key) + '" onclick="openBox(this.dataset.k)">' +
      '<div class="pipe-n">' + b.n + '</div><div class="pipe-l">' + esc(b.label) + '</div></button>';
  }).join('');

  var note = h.prodStage ? '' :
    '<p style="color:var(--bad);font-size:13px;">Is hall ka Complete station set nahi hai (Stations sheet, column D = TRUE).</p>';

  return '<div class="panel"><div class="panel-title">' + esc(h.hall) + ' · stage-wise batteries</div>' + note +
    '<div class="pipe">' + html + '</div>' +
    '<p style="font-size:12px;color:var(--text-muted);margin:12px 0 0;">Har box = woh batteries jinka <b>last scan</b> us stage pe hua, ' +
    'yaani agle stage pe abhi nahi pahunchi. Box pe click karo serial list ke liye.</p>' +
    renderList(h) + '</div>';
}

function renderList(h) {
  if (!state.open) return '';
  var list = h.lists[state.open] || [];
  var title = state.open === '__fg' ? 'Finished goods' : state.open === '__disp' ? 'Dispatch (is period)' : state.open;
  if (!list.length) return '<div class="empty" style="margin-top:12px;">' + esc(title) + ': koi battery nahi.</div>';
  var byM = {};
  list.forEach(function (x) { byM[x.model] = (byM[x.model] || 0) + 1; });
  var chips = Object.keys(byM).sort().map(function (m) {
    return '<span class="hall-tag">' + esc(m) + ': ' + byM[m] + '</span>';
  }).join(' ');
  var rows = list.map(function (x) {
    return '<tr><td class="mono">' + esc(x.serial) + '</td><td>' + esc(x.model) + '</td><td class="mono">' + esc(x.at) + '</td></tr>';
  }).join('');
  return '<div class="history-detail" style="margin-top:12px;"><div style="margin-bottom:8px;"><b>' + esc(title) + '</b> &nbsp;' + chips + '</div>' +
    '<div class="table-wrap"><table><thead><tr><th>Serial</th><th>Model</th><th>Last scan</th></tr></thead><tbody>' +
    rows + '</tbody></table></div>' +
    (list.length >= 300 ? '<p style="font-size:12px;color:var(--text-muted);">Pehli 300 dikh rahi hain.</p>' : '') + '</div>';
}

function modelTable(rows, withHall) {
  if (!rows.length) return '<div class="empty">Koi battery nahi.</div>';
  var body = rows.map(function (x) {
    var m = x.m;
    return '<tr>' + (withHall ? '<td>' + esc(x.hall) + '</td>' : '') +
      '<td>' + esc(m.model) + '</td><td class="mono">' + m.wipTotal + '</td><td class="mono">' + m.prod +
      '</td><td class="mono">' + m.disp + '</td><td class="mono"><b>' + m.fg + '</b></td></tr>';
  }).join('');
  var ms = rows.map(function (x) { return x.m; });
  var foot = '<tr class="stock-total">' + (withHall ? '<td></td>' : '') + '<td>Total</td>' +
    '<td class="mono">' + tot(ms, function (m) { return m.wipTotal; }) + '</td>' +
    '<td class="mono">' + tot(ms, function (m) { return m.prod; }) + '</td>' +
    '<td class="mono">' + tot(ms, function (m) { return m.disp; }) + '</td>' +
    '<td class="mono"><b>' + tot(ms, function (m) { return m.fg; }) + '</b></td></tr>';
  return '<div class="table-wrap"><table><thead><tr>' + (withHall ? '<th>Hall</th>' : '') +
    '<th>Model</th><th>WIP</th><th>Production</th><th>Dispatch</th><th>Finished goods</th></tr></thead><tbody>' +
    body + foot + '</tbody></table></div>';
}

function renderBody() {
  var hs = halls();
  if (!hs.length) return '<div class="panel"><div class="empty">Koi hall nahi mila. Stations sheet me Hall bharo.</div></div>';
  var r = rangeDates();
  var period = r.from === r.to ? r.from : r.from + ' se ' + r.to;
  var info = '<p style="font-size:12px;color:var(--text-muted);margin:0 0 12px;">Production / Dispatch: <b>' + esc(period) +
    '</b> &middot; WIP aur Finished goods: abhi ka live' +
    (state.data.startDate ? ' &middot; ginti ' + esc(state.data.startDate) + ' se' : '') + '</p>';

  if (state.hall === '__all') {
    var rows = [], all = [];
    hs.forEach(function (h) { h.models.forEach(function (m) { rows.push({ hall: h.hall, m: m }); all.push(m); }); });
    return info + statCards(all) + '<div class="panel"><div class="panel-title">Hall + model wise</div>' + modelTable(rows, true) + '</div>';
  }
  var h = curHall() || hs[0];
  return info + statCards(h.models) + renderPipeline(h) +
    '<div class="panel"><div class="panel-title">' + esc(h.hall) + ' · model wise</div>' +
    modelTable(h.models.map(function (m) { return { hall: h.hall, m: m }; }), false) + '</div>';
}

function render() {
  updateConn();
  document.getElementById('contextBar').innerHTML =
    '<a class="context-pill floor" href="admin.html" style="text-decoration:none;">Admin</a>';
  var c = document.getElementById('content');
  if (state.loading) { c.innerHTML = '<div class="empty">Loading...</div>'; return; }
  if (state.statusMsg && !state.data) {
    c.innerHTML = '<div class="panel"><div class="empty"><div class="big">Sheet se data nahi aaya</div>' + esc(state.statusMsg) + '</div></div>';
    return;
  }
  c.innerHTML = renderFilters() + renderBody();
}

/* ---------------- Boot ---------------- */

render();
load();
setInterval(function () { if (!state.pending) load(); }, 60000);
