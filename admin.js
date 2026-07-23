/* Admin page - dashboard, employee output, setup, printable cards.
   PIN-gated so the floor PC can't reach it by accident. */

state = {
  tab: 'dashboard',
  unlocked: false,
  staff: [], stations: [], logs: [], packs: {},
  viewPacks: [], search: '', expandedPack: null,
  empRange: 'today', expandedEmp: null,
  loading: true, connected: true, pending: 0, statusMsg: ''
};

var BREAK_GAP_MS = 30 * 60 * 1000;   // gaps longer than this count as breaks

/* ---------------- PIN gate ---------------- */

function tryUnlock() {
  var el = document.getElementById('pinInput');
  var val = (el && el.value || '').trim();
  if (val !== String(CONFIG.ADMIN_PIN)) {
    document.getElementById('pinError').textContent = 'Wrong PIN. Try again.';
    el.value = '';
    el.focus();
    return;
  }
  state.unlocked = true;
  try { sessionStorage.setItem('plt_admin', '1'); } catch (e) {}
  render();
  loadAll();
}

function lockAdmin() {
  state.unlocked = false;
  try { sessionStorage.removeItem('plt_admin'); } catch (e) {}
  render();
}

function renderPinGate() {
  return '<div class="panel pin-panel">' +
    '<div class="panel-title">Admin access</div>' +
    '<p style="color:var(--text-muted);font-size:13.5px;margin-top:-6px;">Enter the admin PIN to view production and employee data.</p>' +
    '<div class="row" style="max-width:280px;">' +
      '<div class="field"><label>PIN</label>' +
      '<input id="pinInput" type="password" inputmode="numeric" autocomplete="off" ' +
      'onkeydown="if(event.key===\'Enter\') tryUnlock();"></div>' +
    '</div>' +
    '<div id="pinError" style="color:var(--danger);font-size:12.5px;min-height:18px;margin-top:8px;"></div>' +
    '<button class="btn" onclick="tryUnlock()">Unlock</button>' +
  '</div>';
}

/* ---------------- Load ---------------- */

function loadAll() {
  return call('init', { limit: CONFIG.LOG_LIMIT || 3000 }).then(function (res) {
    state.staff = res.staff || [];
    state.stations = res.stations || [];
    state.logs = res.logs || [];
    state.packs = buildPacks(state.logs);
    state.loading = false;
    render();
  }, function (err) {
    state.loading = false;
    state.statusMsg = err.message;
    render();
  });
}

function refreshAll() {
  if (state.pending > 0 || !state.unlocked) return;
  call('init', { limit: CONFIG.LOG_LIMIT || 3000 }).then(function (res) {
    state.staff = res.staff || [];
    state.stations = res.stations || [];
    state.logs = res.logs || [];
    state.packs = buildPacks(state.logs);
    if (state.tab === 'dashboard' || state.tab === 'employees') renderContentOnly();
  }, function () {});
}

/* ---------------- Dashboard ---------------- */

function setTab(t) { state.tab = t; state.expandedPack = null; state.expandedEmp = null; render(); }
function setSearch(v) { state.search = v; renderContentOnly(); }
function togglePack(i) {
  var p = state.viewPacks[i];
  if (!p) return;
  state.expandedPack = state.expandedPack === p.id ? null : p.id;
  renderContentOnly();
}

function renderDashboard() {
  var list = Object.keys(state.packs).map(function (k) { return state.packs[k]; });
  var q = state.search.toLowerCase();
  state.viewPacks = list.filter(function (p) { return !q || p.id.toLowerCase().indexOf(q) >= 0; })
                        .sort(function (a, b) {
                          return b.history[b.history.length - 1].timestamp - a.history[a.history.length - 1].timestamp;
                        });

  var n = function (st) { return list.filter(function (p) { return p.status === st; }).length; };
  var stats = '<div class="stat-grid">' +
    '<div class="stat-card"><div class="num">' + list.length + '</div><div class="lbl">Batteries tracked</div></div>' +
    '<div class="stat-card"><div class="num">' + n('pass') + '</div><div class="lbl">Passed</div></div>' +
    '<div class="stat-card"><div class="num">' + n('fail') + '</div><div class="lbl">Failed</div></div>' +
    '<div class="stat-card"><div class="num">' + n('rework') + '</div><div class="lbl">Rework</div></div>' +
    '</div>';

  var rows = '';
  state.viewPacks.forEach(function (p, i) {
    var last = p.history[p.history.length - 1];
    rows += '<tr style="cursor:pointer" onclick="togglePack(' + i + ')">' +
      '<td class="mono">' + esc(p.id) + '</td>' +
      '<td>' + esc(p.currentStage) + '</td>' +
      '<td>' + esc(last.operatorName) + '</td>' +
      '<td class="mono">' + fmtTime(last.timestamp) + '</td>' +
      '<td><span class="badge ' + badgeClassFor(p.status) + '">' + esc(p.status) + '</span></td></tr>';

    if (state.expandedPack === p.id) {
      var items = p.history.map(function (h, idx) {
        return '<div class="history-item">' +
          '<span class="step-num">' + (idx + 1) + '</span>' +
          '<span style="min-width:150px;">' + esc(h.station) + '</span>' +
          '<span class="mono">' + esc(h.operatorName) + '</span>' +
          '<span class="mono">' + fmtTime(h.timestamp) + '</span>' +
          '<span class="badge ' + badgeClassFor(h.result) + '">' + esc(h.result) + '</span></div>';
      }).join('');
      rows += '<tr><td colspan="5"><div class="history-detail">' + items + '</div></td></tr>';
    }
  });

  return stats +
    '<div class="panel"><div class="panel-title">Every battery</div>' +
    '<div style="margin-bottom:14px;"><input class="search-input" placeholder="Search a battery serial..." ' +
    'oninput="setSearch(this.value)" value="' + esc(state.search) + '"></div>' +
    (state.viewPacks.length
      ? '<div class="table-wrap"><table><thead><tr><th>Battery</th><th>Current stage</th><th>Last employee</th><th>Last scan</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty">No scans recorded yet.</div>') +
    '<p style="font-size:12px;color:var(--text-muted);margin:14px 0 0;">Click any battery to see every stage it passed through and who worked on it.</p>' +
    (list.length ? '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn secondary" onclick="exportTraceCSV()">Export traceability CSV</button>' +
      '<button class="btn secondary" onclick="refreshAll()">Refresh</button></div>' : '') +
    '</div>';
}

function exportTraceCSV() {
  var rows = [['Battery', 'Stage', 'Employee ID', 'Employee', 'Timestamp', 'Result', 'Floor']];
  Object.keys(state.packs).forEach(function (pid) {
    state.packs[pid].history.forEach(function (h) {
      rows.push([pid, h.station, h.operatorId, h.operatorName,
                 new Date(h.timestamp).toISOString(), h.result, CONFIG.FLOOR || '']);
    });
  });
  downloadCSV(rows, 'battery-traceability-' + (CONFIG.FLOOR || 'export') + '.csv');
}

/* ---------------- Employees ---------------- */

function rangeStartMs(range) {
  var d = new Date(); d.setHours(0, 0, 0, 0);
  if (range === 'today') return d.getTime();
  if (range === 'week') return d.getTime() - 6 * 86400000;
  if (range === 'month') return d.getTime() - 29 * 86400000;
  return 0;
}

function dayKey(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/** Average minutes between consecutive scans, ignoring break-length gaps. */
function paceMinutes(times) {
  if (!times || times.length < 3) return null;
  var t = times.slice().sort(function (a, b) { return a - b; });
  var sum = 0, n = 0;
  for (var i = 1; i < t.length; i++) {
    var gap = t[i] - t[i - 1];
    if (gap > 0 && gap <= BREAK_GAP_MS) { sum += gap; n++; }
  }
  if (n < 2) return null;
  return (sum / n) / 60000;
}

function computeEmployeeStats() {
  var from = rangeStartMs(state.empRange);
  var byEmp = {};

  state.logs.forEach(function (r) {
    if (r[0] < from) return;
    var id = r[4];
    if (!id) return;
    if (!byEmp[id]) byEmp[id] = { id: id, name: r[5] || id, total: 0, packs: {}, days: {}, stages: {}, times: [], pass: 0, fail: 0, rework: 0 };
    var e = byEmp[id];
    e.total++;
    e.packs[r[2]] = true;
    e.days[dayKey(r[0])] = true;
    e.times.push(r[0]);
    if (r[6] === 'pass') e.pass++;
    else if (r[6] === 'fail') e.fail++;
    else if (r[6] === 'rework') e.rework++;
    if (!e.stages[r[3]]) e.stages[r[3]] = { name: r[3], count: 0, times: [] };
    e.stages[r[3]].count++;
    e.stages[r[3]].times.push(r[0]);
  });

  return Object.keys(byEmp).map(function (id) {
    var e = byEmp[id];
    e.uniquePacks = Object.keys(e.packs).length;
    e.daysWorked = Object.keys(e.days).length;
    e.avgPerDay = e.daysWorked ? e.total / e.daysWorked : 0;
    e.pace = paceMinutes(e.times);
    e.stageList = Object.keys(e.stages).map(function (k) {
      var st = e.stages[k];
      st.pace = paceMinutes(st.times);
      return st;
    }).sort(function (a, b) { return b.count - a.count; });
    return e;
  }).sort(function (a, b) { return b.total - a.total; });
}

function setEmpRange(r) { state.empRange = r; state.expandedEmp = null; renderContentOnly(); }
function toggleEmp(id) { state.expandedEmp = state.expandedEmp === id ? null : id; renderContentOnly(); }
function fmtPace(p) { return p === null ? '&ndash;' : p.toFixed(1) + ' min'; }

function renderEmployees() {
  var stats = computeEmployeeStats();
  var ranges = [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['all', 'All time']];
  var bar = '<div class="range-bar">' + ranges.map(function (r) {
    return '<button class="range-btn ' + (state.empRange === r[0] ? 'active' : '') +
           '" onclick="setEmpRange(\'' + r[0] + '\')">' + r[1] + '</button>';
  }).join('') + '</div>';

  if (!stats.length) {
    return bar + '<div class="panel"><div class="empty"><div class="big">No scans in this period</div>' +
           'Pick a wider date range.</div></div>';
  }

  var totalScans = stats.reduce(function (a, e) { return a + e.total; }, 0);
  var summary = '<div class="stat-grid">' +
    '<div class="stat-card"><div class="num">' + stats.length + '</div><div class="lbl">Employees active</div></div>' +
    '<div class="stat-card"><div class="num">' + totalScans + '</div><div class="lbl">Total scans</div></div>' +
    '<div class="stat-card"><div class="num" style="font-size:20px;">' + esc(stats[0].name) + '</div><div class="lbl">Highest output</div></div>' +
    '</div>';

  var rows = '';
  stats.forEach(function (e) {
    rows += '<tr style="cursor:pointer" onclick="toggleEmp(\'' + esc(e.id).replace(/'/g, '') + '\')">' +
      '<td><div class="name">' + esc(e.name) + '</div><div class="sub">' + esc(e.id) + '</div></td>' +
      '<td class="mono">' + e.total + '</td>' +
      '<td class="mono">' + e.uniquePacks + '</td>' +
      '<td class="mono">' + e.daysWorked + '</td>' +
      '<td class="mono">' + e.avgPerDay.toFixed(1) + '</td>' +
      '<td class="mono">' + fmtPace(e.pace) + '</td></tr>';

    if (state.expandedEmp === e.id) {
      var inner = e.stageList.map(function (st) {
        return '<div class="history-item">' +
          '<span style="min-width:160px;">' + esc(st.name) + '</span>' +
          '<span class="mono">' + st.count + ' scans</span>' +
          '<span class="mono">' + fmtPace(st.pace) + ' per battery</span></div>';
      }).join('');
      var qc = (e.pass + e.fail + e.rework)
        ? '<div class="history-item"><span style="min-width:160px;">QC outcomes</span>' +
          '<span class="badge pass">' + e.pass + ' pass</span>' +
          '<span class="badge fail">' + e.fail + ' fail</span>' +
          '<span class="badge pending">' + e.rework + ' rework</span></div>' : '';
      rows += '<tr><td colspan="6"><div class="history-detail">' + inner + qc + '</div></td></tr>';
    }
  });

  return bar + summary +
    '<div class="panel"><div class="panel-title">Output by employee</div>' +
    '<div class="table-wrap"><table><thead><tr>' +
    '<th>Employee</th><th>Scans</th><th>Batteries</th><th>Days</th><th>Avg / day</th><th>Pace</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p style="font-size:12px;color:var(--text-muted);margin:14px 0 0;">Click a row for the stage-wise breakdown. ' +
    'Pace is the average time between an employee\'s consecutive scans; gaps over 30 minutes count as breaks and are excluded. ' +
    'Shown after at least 3 readings.</p>' +
    '<div style="margin-top:14px;"><button class="btn secondary" onclick="exportEmployeeCSV()">Export employee CSV</button></div>' +
    '</div>';
}

function exportEmployeeCSV() {
  var stats = computeEmployeeStats();
  var rows = [['Employee ID', 'Name', 'Stage', 'Scans', 'Pace (min)', 'Period']];
  stats.forEach(function (e) {
    rows.push([e.id, e.name, 'ALL STAGES', e.total, e.pace === null ? '' : e.pace.toFixed(1), state.empRange]);
    e.stageList.forEach(function (st) {
      rows.push([e.id, e.name, st.name, st.count, st.pace === null ? '' : st.pace.toFixed(1), state.empRange]);
    });
  });
  downloadCSV(rows, 'employee-output-' + state.empRange + '.csv');
}

/* ---------------- Setup ---------------- */

function addStaff() {
  var nameEl = document.getElementById('staffName'), idEl = document.getElementById('staffId');
  var name = nameEl.value.trim(), id = idEl.value.trim();
  if (!name || !id) { alert('Name and Badge ID are both required.'); return; }
  if (/\s/.test(id)) { alert('Badge ID cannot contain spaces. Check that Name and Badge ID are not swapped.'); return; }
  call('addStaff', { id: id, name: name }).then(function () {
    state.staff.push({ id: id, name: name });
    nameEl.value = ''; idEl.value = '';
    renderContentOnly();
  }, function (err) { alert(err.message); });
}

function removeStaffAt(i) {
  var s = state.staff[i];
  if (!s || !confirm('Remove ' + s.name + '? Past scan history is kept.')) return;
  call('delStaff', { id: s.id }).then(function () {
    state.staff.splice(i, 1); renderContentOnly();
  }, function (err) { alert(err.message); });
}

function addStation() {
  var el = document.getElementById('stationName');
  var name = el.value.trim();
  if (!name) return;
  call('addStation', { name: name }).then(function () {
    state.stations.push(name); el.value = ''; renderContentOnly();
  }, function (err) { alert(err.message); });
}

function removeStationAt(i) {
  var s = state.stations[i];
  if (!s || !confirm('Remove station "' + s + '"? Past scan history is kept.')) return;
  call('delStation', { name: s }).then(function () {
    state.stations.splice(i, 1); renderContentOnly();
  }, function (err) { alert(err.message); });
}

function moveStation(i, dir) {
  var j = i + dir;
  if (j < 0 || j >= state.stations.length) return;
  var tmp = state.stations[i]; state.stations[i] = state.stations[j]; state.stations[j] = tmp;
  renderContentOnly();
  call('reorderStations', { stations: JSON.stringify(state.stations) }).then(null, function (err) {
    alert('Order not saved: ' + err.message); loadAll();
  });
}

function renderSetup() {
  var staffRows = state.staff.map(function (s, i) {
    return '<div class="list-row"><div><div class="name">' + esc(s.name) + '</div><div class="sub">' + esc(s.id) + '</div></div>' +
           '<button class="icon-btn danger" onclick="removeStaffAt(' + i + ')">X</button></div>';
  }).join('');

  var stationRows = state.stations.map(function (s, i) {
    return '<div class="list-row"><div><span class="mono" style="color:var(--accent)">' + (i + 1) + '</span> &nbsp; ' +
      '<span class="name">' + esc(s) + '</span></div><div style="display:flex;gap:6px;">' +
      '<button class="icon-btn" onclick="moveStation(' + i + ',-1)">Up</button>' +
      '<button class="icon-btn" onclick="moveStation(' + i + ',1)">Dn</button>' +
      '<button class="icon-btn danger" onclick="removeStationAt(' + i + ')">X</button></div></div>';
  }).join('');

  return '<div class="panel"><div class="panel-title">Employees</div>' +
      (staffRows || '<div class="empty">No employees added yet.</div>') +
      '<div class="row" style="margin-top:12px;">' +
        '<div class="field"><label>Name (e.g. the person\'s full name)</label><input id="staffName" placeholder="Full name"></div>' +
        '<div class="field"><label>Badge ID (goes on the barcode)</label><input id="staffId" placeholder="OP-101"></div>' +
      '</div>' +
      '<div style="margin-top:10px;"><button class="btn" onclick="addStaff()">Add employee</button></div>' +
      '<p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">The card below shows the name in bold and the badge ID underneath. If they look swapped, remove and re-add.</p>' +
    '</div>' +
    '<div class="panel"><div class="panel-title">Stations (order = line sequence)</div>' +
      (stationRows || '<div class="empty">No stations added yet.</div>') +
      '<div class="row" style="margin-top:12px;"><div class="field"><label>New station name</label><input id="stationName" placeholder="Spot Welding"></div></div>' +
      '<div style="margin-top:10px;"><button class="btn" onclick="addStation()">Add station</button></div>' +
    '</div>';
}

/* ---------------- Print cards ---------------- */

function renderCards() {
  return '<div class="panel"><div class="panel-title">Station cards and employee badges</div>' +
    '<p style="color:var(--text-muted);font-size:13.5px;">Print, laminate, place one station card at each station and hand each employee their badge. Scanning a card sets the context on the floor PC.</p>' +
    '<button class="btn" onclick="window.print()">Print this page</button></div>' +
    '<div id="printArea">' +
      '<div class="panel"><div class="panel-title">Station cards</div><div class="card-grid" id="stationCards"></div></div>' +
      '<div class="panel"><div class="panel-title">Employee badges</div><div class="card-grid" id="staffCards"></div></div>' +
    '</div>';
}

function drawBarcodes() {
  if (state.tab !== 'cards' || typeof JsBarcode === 'undefined') return;
  var stEl = document.getElementById('stationCards');
  var stfEl = document.getElementById('staffCards');
  if (stEl) {
    stEl.innerHTML = state.stations.map(function (s, i) {
      return '<div class="print-card"><div class="label">' + esc(s) + '</div><svg id="stc' + i + '"></svg></div>';
    }).join('');
    state.stations.forEach(function (s, i) {
      JsBarcode('#stc' + i, 'STATION:' + s, { format: 'CODE128', width: 2, height: 60, displayValue: false });
    });
  }
  if (stfEl) {
    stfEl.innerHTML = state.staff.map(function (s, i) {
      return '<div class="print-card"><div class="label">' + esc(s.name) + '</div><svg id="stfc' + i + '"></svg>' +
             '<div class="sub" style="margin-top:6px;">' + esc(s.id) + '</div></div>';
    }).join('');
    state.staff.forEach(function (s, i) {
      JsBarcode('#stfc' + i, 'STAFF:' + s.id, { format: 'CODE128', width: 2, height: 60, displayValue: false });
    });
  }
}

/* ---------------- Shell ---------------- */

function renderTabs() {
  var el = document.getElementById('tabs');
  if (!state.unlocked) { el.innerHTML = ''; return; }
  var tabs = [['dashboard', 'Dashboard'], ['employees', 'Employees'], ['setup', 'Setup'], ['cards', 'Print Cards']];
  el.innerHTML = tabs.map(function (t) {
    return '<button class="tab ' + (state.tab === t[0] ? 'active' : '') + '" onclick="setTab(\'' + t[0] + '\')">' + t[1] + '</button>';
  }).join('');
}

function renderContextBar() {
  var el = document.getElementById('contextBar');
  el.innerHTML = '<div class="context-pill floor">' + esc(CONFIG.FLOOR || 'NO FLOOR') + '</div>' +
    (state.unlocked ? '<button class="range-btn" onclick="lockAdmin()">Lock</button>' : '');
}

function renderContentOnly() {
  var c = document.getElementById('content');
  if (state.tab === 'dashboard') c.innerHTML = renderDashboard();
  else if (state.tab === 'employees') c.innerHTML = renderEmployees();
  else if (state.tab === 'setup') c.innerHTML = renderSetup();
  else if (state.tab === 'cards') { c.innerHTML = renderCards(); setTimeout(drawBarcodes, 30); }
}

function render() {
  renderTabs();
  renderContextBar();
  updateConn();
  var c = document.getElementById('content');

  if (!state.unlocked) {
    c.innerHTML = renderPinGate();
    var pin = document.getElementById('pinInput');
    if (pin) pin.focus();
    return;
  }
  if (state.loading) { c.innerHTML = '<div class="empty">Loading from the Sheet...</div>'; return; }
  if (state.statusMsg && !state.stations.length) {
    c.innerHTML = '<div class="panel"><div class="empty"><div class="big">Could not reach the Sheet</div>' +
                  esc(state.statusMsg) + '</div></div>';
    state.statusMsg = '';
    return;
  }
  renderContentOnly();
}

/* ---------------- Boot ---------------- */
if (!CONFIG.ADMIN_PIN) state.unlocked = true;
try {
  if (sessionStorage.getItem('plt_admin') === '1') state.unlocked = true;
} catch (e) {}

render();
if (state.unlocked) loadAll();
if (CONFIG.POLL_MS) setInterval(refreshAll, Math.max(CONFIG.POLL_MS, 20000));
