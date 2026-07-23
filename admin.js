/* Admin page - dashboard, employee output, setup, printable cards.
   PIN-gated so the floor PC can't reach it by accident. */

state = {
  tab: 'dashboard',
  unlocked: false,
  staff: [], stations: [], logs: [], packs: {},
  viewPacks: [], search: '', expandedPack: null,
  empRange: 'today', expandedEmp: null,
  sel: { station: {}, staff: {} },   // false = unchecked; missing = checked
  labels: [],                        // serials currently laid out for printing
  loading: true, connected: true, pending: 0, statusMsg: ''
};

function breakGapMs() { return (CONFIG.BREAK_GAP_MINUTES || 30) * 60000; }

/* ---------------- PIN gate ---------------- */

function tryUnlock() {
  var el = document.getElementById('pinInput');
  var val = (el && el.value || '').trim();
  var err = document.getElementById('pinError');
  err.textContent = 'Checking...';
  call('checkPin', { pin: val }).then(function (res) {
    if (!res.valid) {
      err.textContent = 'Wrong PIN. Try again.';
      el.value = ''; el.focus();
      return;
    }
    state.unlocked = true;
    try { sessionStorage.setItem('plt_admin', '1'); } catch (e) {}
    render();
    loadAll();
  }, function (e) {
    err.textContent = 'Could not reach the Sheet: ' + e.message;
  });
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
    applySettings(res.settings);
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
    applySettings(res.settings);
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
    if (gap > 0 && gap <= breakGapMs()) { sum += gap; n++; }
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
    'Pace is the average time between an employee\'s consecutive scans; gaps over ' + (CONFIG.BREAK_GAP_MINUTES || 30) + ' minutes count as breaks and are excluded. ' +
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

  var st = CONFIG.SETTINGS || {};
  var settingRows = Object.keys(st).filter(function (k) { return k !== 'PinRequired'; })
    .map(function (k) {
      return '<tr><td class="mono">' + esc(k) + '</td><td class="mono">' + esc(st[k]) + '</td></tr>';
    }).join('');

  var settingsPanel = '<div class="panel"><div class="panel-title">Settings (edit in the Sheet)</div>' +
    '<p style="color:var(--text-muted);font-size:13.5px;margin-top:-6px;">These come from the Settings tab of the ' +
    'Google Sheet. Change a value there, then reload this page. Nothing here needs a code change.</p>' +
    '<div class="table-wrap"><table><thead><tr><th>Key</th><th>Current value</th></tr></thead><tbody>' +
    settingRows + '</tbody></table></div></div>';

  return settingsPanel +
    '<div class="panel"><div class="panel-title">Employees</div>' +
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

function isSel(type, i) { return state.sel[type][i] !== false; }

function toggleCard(type, i, el) {
  state.sel[type][i] = !!el.checked;
  var card = document.getElementById('card-' + type + '-' + i);
  if (card) card.className = 'print-card' + (el.checked ? '' : ' unselected');
  updatePrintCount();
}

function selectAllCards(v) {
  state.stations.forEach(function (s, i) { state.sel.station[i] = v; });
  state.staff.forEach(function (s, i) { state.sel.staff[i] = v; });
  ['station', 'staff'].forEach(function (type) {
    var list = type === 'station' ? state.stations : state.staff;
    list.forEach(function (s, i) {
      var box = document.getElementById('chk-' + type + '-' + i);
      var card = document.getElementById('card-' + type + '-' + i);
      if (box) box.checked = v;
      if (card) card.className = 'print-card' + (v ? '' : ' unselected');
    });
  });
  updatePrintCount();
}

function countSelected() {
  var n = 0;
  state.stations.forEach(function (s, i) { if (isSel('station', i)) n++; });
  state.staff.forEach(function (s, i) { if (isSel('staff', i)) n++; });
  return n;
}

function updatePrintCount() {
  var el = document.getElementById('printCount');
  if (el) el.textContent = countSelected();
}

function printSelected() {
  if (!countSelected()) { alert('Nothing selected. Tick at least one card to print.'); return; }
  window.print();
}

function renderCards() {
  return '<div class="panel"><div class="panel-title">Station cards and employee badges</div>' +
    '<p style="color:var(--text-muted);font-size:13.5px;margin-top:-6px;">Untick anything you do not need, then print. ' +
    'Added one new employee? Clear all, tick just that badge, and print a single card.</p>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
      '<button class="btn" onclick="printSelected()">Print selected (<span id="printCount">0</span>)</button>' +
      '<button class="btn secondary" onclick="selectAllCards(true)">Select all</button>' +
      '<button class="btn secondary" onclick="selectAllCards(false)">Clear all</button>' +
    '</div></div>' +
    '<div id="printArea">' +
      '<div class="panel"><div class="panel-title">Station cards</div><div class="card-grid" id="stationCards"></div></div>' +
      '<div class="panel"><div class="panel-title">Employee badges</div><div class="card-grid" id="staffCards"></div></div>' +
    '</div>';
}

function ensureJsBarcode(cb) {
  if (typeof JsBarcode !== 'undefined') { cb(true); return; }
  // Primary CDN blocked or slow - try a second one before giving up.
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
  s.onload = function () { cb(typeof JsBarcode !== 'undefined'); };
  s.onerror = function () { cb(false); };
  document.head.appendChild(s);
}

function drawBarcodes() {
  if (state.tab !== 'cards') return;
  var stEl = document.getElementById('stationCards');
  var stfEl = document.getElementById('staffCards');
  if (!stEl || !stfEl) return;

  // Draw the cards first, so labels are visible even if barcodes fail.
  stEl.innerHTML = state.stations.length
    ? state.stations.map(function (s, i) {
        var on = isSel('station', i);
        return '<div class="print-card' + (on ? '' : ' unselected') + '" id="card-station-' + i + '">' +
               '<input type="checkbox" class="card-check" id="chk-station-' + i + '"' + (on ? ' checked' : '') +
               ' onchange="toggleCard(\'station\',' + i + ',this)">' +
               '<div class="label">' + esc(s) + '</div>' +
               '<svg id="stc' + i + '"></svg><div class="sub">STATION:' + esc(s) + '</div></div>';
      }).join('')
    : '<div class="empty">No stations added yet. Add them on the Setup tab.</div>';

  stfEl.innerHTML = state.staff.length
    ? state.staff.map(function (s, i) {
        var on = isSel('staff', i);
        return '<div class="print-card' + (on ? '' : ' unselected') + '" id="card-staff-' + i + '">' +
               '<input type="checkbox" class="card-check" id="chk-staff-' + i + '"' + (on ? ' checked' : '') +
               ' onchange="toggleCard(\'staff\',' + i + ',this)">' +
               '<div class="label">' + esc(s.name) + '</div>' +
               '<svg id="stfc' + i + '"></svg><div class="sub">' + esc(s.id) + '</div></div>';
      }).join('')
    : '<div class="empty">No employees added yet. Add them on the Setup tab.</div>';

  updatePrintCount();

  ensureJsBarcode(function (ok) {
    if (!ok) {
      var msg = '<div class="panel" style="border-color:var(--danger-border);background:var(--danger-dim);">' +
        '<div class="panel-title" style="color:var(--danger);">Barcode library did not load</div>' +
        'The barcode generator is fetched from the internet. This PC could not reach it - check the connection ' +
        'or the network filter, then reload the page. Card names are shown above without barcodes.</div>';
      var area = document.getElementById('printArea');
      if (area && !document.getElementById('bcWarn')) {
        var d = document.createElement('div');
        d.id = 'bcWarn';
        d.innerHTML = msg;
        area.insertBefore(d, area.firstChild);
      }
      return;
    }
    var opts = { format: 'CODE128', width: 2, height: 60, displayValue: false, margin: 6 };
    state.stations.forEach(function (s, i) {
      try { JsBarcode('#stc' + i, 'STATION:' + s, opts); } catch (e) {}
    });
    state.staff.forEach(function (s, i) {
      try { JsBarcode('#stfc' + i, 'STAFF:' + s.id, opts); } catch (e) {}
    });
  });
}


/* ------------------------------------------------------------------ */
/* Battery labels                                                      */
/* ------------------------------------------------------------------ */

function ensureQR(cb) {
  if (typeof qrcode !== 'undefined') { cb(true); return; }
  var a = document.createElement('script');
  a.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  a.onload = function () { cb(typeof qrcode !== 'undefined'); };
  a.onerror = function () {
    var b = document.createElement('script');
    b.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    b.onload = function () { cb(typeof qrcode !== 'undefined'); };
    b.onerror = function () { cb(false); };
    document.head.appendChild(b);
  };
  document.head.appendChild(a);
}

function generateSerials() {
  var qty = parseInt(document.getElementById('labelQty').value, 10);
  if (!qty || qty < 1) { alert('Enter how many batteries you need labels for.'); return; }
  if (qty > 200) { alert('Maximum 200 at a time.'); return; }

  var btn = document.getElementById('genBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

  call('newSerials', { qty: qty }).then(function (res) {
    state.labels = res.serials || [];
    renderContentOnly();
  }, function (err) {
    alert('Could not generate serials: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Generate serials'; }
  });
}

function loadReprint() {
  var raw = document.getElementById('reprintBox').value || '';
  var list = raw.split(/[\n,\s]+/).map(function (v) { return v.trim(); }).filter(function (v) { return v; });
  if (!list.length) { alert('Paste at least one serial number.'); return; }
  if (list.length > 200) { alert('Maximum 200 at a time.'); return; }
  state.labels = list;
  renderContentOnly();
}

function clearLabels() { state.labels = []; renderContentOnly(); }

function renderLabels() {
  var w = CONFIG.LABEL_WIDTH_MM || 50;
  var h = CONFIG.LABEL_HEIGHT_MM || 25;

  var head = '<div class="panel"><div class="panel-title">New battery labels</div>' +
    '<p style="color:var(--text-muted);font-size:13.5px;margin-top:-6px;">Each serial is recorded in the ' +
    'BatteryMaster sheet the moment it is generated, so a number is never issued twice.</p>' +
    '<div class="row" style="max-width:320px;">' +
      '<div class="field"><label>How many batteries</label>' +
      '<input id="labelQty" type="number" min="1" max="200" value="10" ' +
      'onkeydown="if(event.key===\'Enter\') generateSerials();"></div>' +
    '</div>' +
    '<div style="margin-top:10px;"><button class="btn" id="genBtn" onclick="generateSerials()">Generate serials</button></div>' +
    '</div>' +
    '<div class="panel"><div class="panel-title">Reprint existing labels</div>' +
    '<p style="color:var(--text-muted);font-size:13.5px;margin-top:-6px;">Label damaged or lost? Paste the serials ' +
    '(one per line). Nothing new is created.</p>' +
    '<textarea id="reprintBox" class="search-input" rows="3" placeholder="LP-2607-0001"></textarea>' +
    '<div style="margin-top:10px;"><button class="btn secondary" onclick="loadReprint()">Load these serials</button></div>' +
    '</div>';

  if (!state.labels.length) {
    return head + '<div class="panel"><div class="empty"><div class="big">No labels laid out yet</div>' +
           'Generate new serials, or paste existing ones to reprint.</div></div>';
  }

  return head +
    '<div class="panel"><div class="panel-title">' + state.labels.length + ' label(s) ready &middot; ' + w + ' x ' + h + ' mm</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn" onclick="window.print()">Print labels</button>' +
      '<button class="btn secondary" onclick="copySerials()">Copy serials</button>' +
      '<button class="btn secondary" onclick="clearLabels()">Clear</button>' +
    '</div>' +
    '<p style="font-size:12px;color:var(--text-muted);margin:12px 0 0;">Set the printer to the same label size and ' +
    'turn off any scaling, or the QR will not scan. Change the size in config.js.</p>' +
    '</div>' +
    '<div id="labelArea" class="print-target"><div class="label-sheet" id="labelSheet"></div></div>';
}

function copySerials() {
  var txt = state.labels.join('\n');
  if (navigator.clipboard) navigator.clipboard.writeText(txt);
  else window.prompt('Copy these serials:', txt);
}

function drawLabels() {
  var host = document.getElementById('labelSheet');
  if (!host || !state.labels.length) return;
  var w = CONFIG.LABEL_WIDTH_MM || 50;
  var h = CONFIG.LABEL_HEIGHT_MM || 25;

  host.innerHTML = state.labels.map(function (sn, i) {
    return '<div class="battery-label" style="width:' + w + 'mm;height:' + h + 'mm;">' +
             '<div class="ql" id="ql' + i + '"></div>' +
             '<div class="qt"><div class="qt-brand">LITPAX</div>' +
             '<div class="qt-serial">' + esc(sn) + '</div></div>' +
           '</div>';
  }).join('');

  ensureQR(function (ok) {
    if (!ok) {
      host.insertAdjacentHTML('beforebegin',
        '<div class="panel" style="border-color:var(--danger-border);background:var(--danger-dim);">' +
        '<div class="panel-title" style="color:var(--danger);">QR library did not load</div>' +
        'This PC could not reach the QR generator. Check the connection and reload. Serials are still saved.</div>');
      return;
    }
    state.labels.forEach(function (sn, i) {
      var cell = document.getElementById('ql' + i);
      if (!cell) return;
      try {
        var q = qrcode(0, 'M');       // auto version, medium error correction
        q.addData(sn);
        q.make();
        cell.innerHTML = q.createSvgTag({ scalable: true, margin: 0 });
      } catch (e) { cell.textContent = sn; }
    });
  });
}

/* ---------------- Shell ---------------- */

function renderTabs() {
  var el = document.getElementById('tabs');
  if (!state.unlocked) { el.innerHTML = ''; return; }
  var tabs = [['dashboard', 'Dashboard'], ['employees', 'Employees'], ['labels', 'Battery Labels'],
              ['setup', 'Setup'], ['cards', 'Print Cards']];
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
  else if (state.tab === 'labels') { c.innerHTML = renderLabels(); setTimeout(drawLabels, 30); }
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

// Settings decide whether a PIN is needed at all, so fetch them first.
call('settings', {}).then(function (res) {
  applySettings(res.settings);
  if (!CONFIG.PIN_REQUIRED) state.unlocked = true;
  render();
  if (state.unlocked) loadAll();
  if (CONFIG.POLL_MS) setInterval(refreshAll, Math.max(CONFIG.POLL_MS, 20000));
}, function (err) {
  state.statusMsg = err.message;
  render();
});
