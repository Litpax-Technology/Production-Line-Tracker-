/* Admin page - dashboard, employee output, setup, printable cards.
   PIN gate removed - admin opens directly. */

state = {
  tab: 'dashboard',
  unlocked: true,
  staff: [], stations: [], logs: [], packs: {},
  viewPacks: [], search: '', expandedPack: null,
  empRange: 'today', expandedEmp: null,
  sel: { station: {}, staff: {} },   // false = unchecked; missing = checked
  labels: [], labelModel: '', labelHall: '',        // serials currently laid out for printing
  labelPick: '', labelCellOpt: 'Main', labelBmsOpt: 'Main', modelsError: '',
  models: [], halls: [], stationRows: [],
  empFrom: '', empTo: '',            // custom date range on the Employees tab
  loading: true, connected: true, pending: 0, statusMsg: ''
};

function breakGapMs() { return (CONFIG.BREAK_GAP_MINUTES || 30) * 60000; }

/* ---------------- Load ---------------- */

function loadAll() {
  return call('init', { limit: CONFIG.LOG_LIMIT || 3000 }).then(function (res) {
    applySettings(res.settings);
    state.models = res.models || [];
    state.modelsError = res.modelsError || '';
    state.staff = res.staff || [];
    state.stations = res.stations || [];
    state.stationRows = res.stationRows || [];
    state.halls = res.halls || [];
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
    state.models = res.models || [];
    state.modelsError = res.modelsError || '';
    state.staff = res.staff || [];
    state.stations = res.stations || [];
    state.stationRows = res.stationRows || [];
    state.halls = res.halls || [];
    state.logs = res.logs || [];
    state.packs = buildPacks(state.logs);
    if (state.tab === 'dashboard' || state.tab === 'employees') renderContentOnly();
  }, function () {});
}

/* ---------------- Dashboard ---------------- */

function setTab(t) {
  state.tab = t; state.expandedPack = null; state.expandedEmp = null;
  if (t === 'manual' && state.sup) state.sup.loaded = false;
  render();
}
function setSearch(v) { state.search = v; renderContentOnly(); }
function togglePack(i) {
  var p = state.viewPacks[i];
  if (!p) return;
  state.expandedPack = state.expandedPack === p.id ? null : p.id;
  renderContentOnly();
}

function packState(p) {
  var h = p.history;
  var lastResult = String(h[h.length - 1].result || '').toLowerCase();
  if (lastResult === 'fail')   return { key: 'fail',     label: 'Fail',        cls: 'fail' };
  if (lastResult === 'rework') return { key: 'rework',   label: 'Rework',      cls: 'pending' };
  var flagged = (state.stationRows || []).filter(function (r) { return r.complete; })
                                         .map(function (r) { return r.name; });
  var done;
  if (flagged.length) {
    done = h.some(function (x) { return flagged.indexOf(x.station) >= 0; });
  } else {
    var completeStage = (CONFIG.SETTINGS && CONFIG.SETTINGS.CompleteStage) ||
                        (state.stations.length ? state.stations[state.stations.length - 1] : '');
    done = completeStage && h.some(function (x) { return x.station === completeStage; });
  }
  if (done) return { key: 'complete', label: 'Complete', cls: 'pass' };
  return { key: 'progress', label: 'In progress', cls: 'pending' };
}

function renderDashboard() {
  var list = Object.keys(state.packs).map(function (k) { return state.packs[k]; });
  var q = state.search.toLowerCase();
  state.viewPacks = list.filter(function (p) { return !q || p.id.toLowerCase().indexOf(q) >= 0; })
                        .sort(function (a, b) {
                          return b.history[b.history.length - 1].timestamp - a.history[a.history.length - 1].timestamp;
                        });

 var cnt = { progress: 0, complete: 0, fail: 0, rework: 0 };
  list.forEach(function (p) { cnt[packState(p).key]++; });
  var stats = '<div class="stat-grid">' +
    '<div class="stat-card"><div class="num">' + list.length + '</div><div class="lbl">Batteries tracked</div></div>' +
    '<div class="stat-card"><div class="num">' + cnt.progress + '</div><div class="lbl">In progress</div></div>' +
    '<div class="stat-card"><div class="num">' + cnt.complete + '</div><div class="lbl">Complete</div></div>' +
    '<div class="stat-card"><div class="num">' + (cnt.fail + cnt.rework) + '</div><div class="lbl">Fail / Rework</div></div>' +
    '</div>';

  var rows = '';
  state.viewPacks.forEach(function (p, i) {
     var last = p.history[p.history.length - 1];
    var ps = packState(p);
    rows += '<tr style="cursor:pointer" onclick="togglePack(' + i + ')">' +
      '<td class="mono">' + esc(p.id) + '</td>' +
      '<td>' + esc(p.currentStage) + '</td>' +
      '<td>' + esc(last.operatorName) + '</td>' +
      '<td class="mono">' + fmtTime(last.timestamp) + '</td>' +
      '<td><span class="badge ' + ps.cls + '">' + ps.label + '</span></td></tr>';

    if (state.expandedPack === p.id) {
      var items = p.history.map(function (h, idx) {
        var res = String(h.result || '').toLowerCase();
        var badgeCls, badgeTxt;
        if (res === 'fail')        { badgeCls = 'fail';    badgeTxt = 'Fail'; }
        else if (res === 'rework') { badgeCls = 'pending'; badgeTxt = 'Rework'; }
        else                       { badgeCls = 'pass';    badgeTxt = 'Done'; }
        return '<div class="history-item">' +
          '<span class="step-num">' + (idx + 1) + '</span>' +
          '<span style="min-width:150px;">' + esc(h.station) + '</span>' +
          '<span class="mono">' + esc(h.operatorName) + '</span>' +
          '<span class="mono">' + fmtTime(h.timestamp) + '</span>' +
          '<span class="badge ' + badgeCls + '">' + badgeTxt + '</span></div>';
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
  if (range === 'custom') {
    if (!state.empFrom) return 0;
    var f = new Date(state.empFrom); f.setHours(0, 0, 0, 0);
    return f.getTime();
  }
  var d = new Date(); d.setHours(0, 0, 0, 0);
  if (range === 'today') return d.getTime();
  if (range === 'week') return d.getTime() - 6 * 86400000;
  if (range === 'month') return d.getTime() - 29 * 86400000;
  return 0;
}

function rangeEndMs(range) {
  if (range === 'custom' && state.empTo) {
    var t = new Date(state.empTo); t.setHours(23, 59, 59, 999);
    return t.getTime();
  }
  return Infinity;
}

function rangeLabel() {
  if (state.empRange !== 'custom') return state.empRange;
  return (state.empFrom || 'start') + ' to ' + (state.empTo || 'today');
}

function setCustomFrom(v) { state.empFrom = v; state.empRange = 'custom'; renderContentOnly(); }
function setCustomTo(v) { state.empTo = v; state.empRange = 'custom'; renderContentOnly(); }

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
  var to = rangeEndMs(state.empRange);
  var byEmp = {};

  state.logs.forEach(function (r) {
    if (r[0] < from || r[0] > to) return;
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
  var ranges = [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days'],
                ['all', 'All time'], ['custom', 'Custom dates']];
  var bar = '<div class="range-bar">' + ranges.map(function (r) {
    return '<button class="range-btn ' + (state.empRange === r[0] ? 'active' : '') +
           '" onclick="setEmpRange(\'' + r[0] + '\')">' + r[1] + '</button>';
  }).join('') + '</div>';

  if (state.empRange === 'custom') {
    bar += '<div class="panel" style="padding:16px;"><div class="row" style="max-width:520px;">' +
      '<div class="field"><label>From</label><input type="date" value="' + esc(state.empFrom) +
      '" onchange="setCustomFrom(this.value)"></div>' +
      '<div class="field"><label>To</label><input type="date" value="' + esc(state.empTo) +
      '" onchange="setCustomTo(this.value)"></div>' +
      '</div><p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">Leave a box empty for an open end. ' +
      'Only scans still within LogLimit are available - raise it in the Settings sheet to look further back.</p></div>';
  }

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
    rows.push([e.id, e.name, 'ALL STAGES', e.total, e.pace === null ? '' : e.pace.toFixed(1), rangeLabel()]);
    e.stageList.forEach(function (st) {
      rows.push([e.id, e.name, st.name, st.count, st.pace === null ? '' : st.pace.toFixed(1), rangeLabel()]);
    });
  });
  downloadCSV(rows, 'employee-output-' + rangeLabel().replace(/[^0-9a-zA-Z-]+/g, '_') + '.csv');
}

/* ---------------- Setup ---------------- */


function hallOptions(sel, allowNew) {
  var opts = '<option value="">-- pick hall --</option>';
  state.halls.forEach(function (h) {
    opts += '<option value="' + esc(h) + '"' + (sel === h ? ' selected' : '') + '>' + esc(h) + '</option>';
  });
  if (allowNew) opts += '<option value="__new__">+ new hall...</option>';
  return opts;
}

function hallFromField(selId, newId) {
  var sel = document.getElementById(selId);
  var v = sel ? sel.value : '';
  if (v === '__new__') {
    var nv = document.getElementById(newId);
    return nv ? nv.value.trim() : '';
  }
  return v;
}

function onHallSelect(selId, newWrapId) {
  var sel = document.getElementById(selId);
  var wrap = document.getElementById(newWrapId);
  if (wrap) wrap.style.display = (sel && sel.value === '__new__') ? 'flex' : 'none';
}

function addStaff() {
  var nameEl = document.getElementById('staffName'), idEl = document.getElementById('staffId');
  var name = nameEl.value.trim(), id = idEl.value.trim();
  var hall = hallFromField('staffHall', 'staffHallNew');
  if (!name || !id) { alert('Name and Badge ID are both required.'); return; }
  if (/\s/.test(id)) { alert('Badge ID cannot contain spaces. Check that Name and Badge ID are not swapped.'); return; }
  if (!hall) { alert('Pick or type the hall for this employee.'); return; }
  call('addStaff', { id: id, name: name, hall: hall }).then(function () {
    state.staff.push({ id: id, name: name, hall: hall });
    if (state.halls.indexOf(hall) < 0) state.halls.push(hall);
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
  var codeEl = document.getElementById('stationCode');
  var name = el.value.trim();
  var code = codeEl ? codeEl.value.trim().toUpperCase() : '';
  var hall = hallFromField('stationHall', 'stationHallNew');
  if (!name) return;
  if (!code) { alert('Enter a short Code (scanner prefix, e.g. SPOT2W).'); return; }
  if (!hall) { alert('Pick or type the hall for this station.'); return; }
  call('addStation', { name: name, hall: hall, code: code }).then(function () {
    state.stations.push(name);
    state.stationRows.push({ name: name, hall: hall, code: code });
    if (state.halls.indexOf(hall) < 0) state.halls.push(hall);
    el.value = ''; if (codeEl) codeEl.value = '';
    renderContentOnly();
  }, function (err) { alert(err.message); });
}

function removeStationAt(i) {
  var s = state.stationRows[i];
  if (!s || !confirm('Remove station "' + s.name + '"? Past scan history is kept.')) return;
  call('delStation', { code: s.code, name: s.name }).then(function () {
    state.stationRows.splice(i, 1);
    state.stations = state.stationRows.map(function (r) { return r.name; });
    renderContentOnly();
  }, function (err) { alert(err.message); });
}

function changeStationHall(code, hall) {
  call('setStationHall', { code: code, hall: hall }).then(function () {
    state.stationRows.forEach(function (r) { if (r.code === code) r.hall = hall; });
    if (hall && state.halls.indexOf(hall) < 0) { state.halls.push(hall); renderContentOnly(); }
  }, function (err) { alert(err.message); });
}

function moveStation(i, dir) {
  var j = i + dir;
  if (j < 0 || j >= state.stationRows.length) return;
  var tmp = state.stationRows[i]; state.stationRows[i] = state.stationRows[j]; state.stationRows[j] = tmp;
  state.stations = state.stationRows.map(function (r) { return r.name; });
  renderContentOnly();
  var codes = state.stationRows.map(function (r) { return r.code || r.name; });
  call('reorderStations', { stations: JSON.stringify(codes) }).then(null, function (err) {
    alert('Order not saved: ' + err.message); loadAll();
  });
}

function renderSetup() {
  var staffRows = state.staff.map(function (s, i) {
    var hall = s.hall ? '<span class="hall-tag">' + esc(s.hall) + '</span>' : '<span class="hall-tag warn">no hall</span>';
    return '<div class="list-row"><div><div class="name">' + esc(s.name) + ' ' + hall + '</div>' +
           '<div class="sub">' + esc(s.id) + '</div></div>' +
           '<button class="icon-btn danger" onclick="removeStaffAt(' + i + ')">X</button></div>';
  }).join('');

var stationRows = state.stationRows.map(function (r, i) {
    var curHall = r.hall || '';
    var codeStr = String(r.code || '').replace(/'/g, '');
    var hallSel = '<select class="hall-inline" onchange="changeStationHall(\'' + codeStr + '\', this.value)">' +
      '<option value="">no hall</option>' +
      state.halls.map(function (h) {
        return '<option value="' + esc(h) + '"' + (curHall === h ? ' selected' : '') + '>' + esc(h) + '</option>';
      }).join('') + '</select>';
    return '<div class="list-row"><div><span class="mono" style="color:var(--accent)">' + (i + 1) + '</span> &nbsp; ' +
      '<span class="name">' + esc(r.name) + '</span> ' +
      (r.code ? '<span class="hall-tag">' + esc(r.code) + '</span>' : '<span class="hall-tag warn">no code</span>') +
      '</div><div style="display:flex;gap:6px;align-items:center;">' +
      hallSel +
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

  var modelRows = state.models.map(function (m) {
    var cell = (m.cellOptions || []).map(function (o) {
      return esc(o.item) + ' ×' + o.qty + ' <span class="hall-tag">' + esc(o.opt) + '</span>';
    }).join('<br>') || '<span class="hall-tag warn">cell nahi</span>';
    var bms = (m.bmsOptions || []).map(function (o) {
      return esc(o.item) + ' <span class="hall-tag">' + esc(o.opt) + '</span>';
    }).join('<br>') || '<span class="hall-tag warn">BMS nahi</span>';
    return '<div class="list-row" style="flex-wrap:wrap;gap:10px;align-items:flex-start;">' +
      '<div style="flex:1 1 170px;"><div class="name">' + esc(m.name) + '</div>' +
      '<div class="sub">Serial code: ' + esc(m.code) + '</div></div>' +
      '<div style="flex:1 1 240px;font-size:12px;line-height:1.7;">' + cell + '</div>' +
      '<div style="flex:1 1 200px;font-size:12px;line-height:1.7;">' + bms + '</div></div>';
  }).join('');

  var modelsPanel = '<div class="panel"><div class="panel-title">Battery models (Master Sheet se)</div>' +
    (state.modelsError ? '<div class="empty" style="color:var(--danger);">' + esc(state.modelsError) + '</div>' : '') +
    (modelRows || '<div class="empty">Master Sheet me koi active model nahi mila.</div>') +
    '<p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">Model, Cells aur BMS sirf <b>Master Sheet</b> ' +
    '(Models + BOM tab) me banao/badlo. Yahan sirf dekhne ke liye hai. Master ka badlav yahan 5 minute me dikhta hai. Serial pattern: ' +
    esc(CONFIG.SETTINGS && CONFIG.SETTINGS.SerialPrefix || 'LP-') + '&lt;serial code&gt;-00001.</p>' +
    '</div>';

  return settingsPanel + modelsPanel +
    '<div class="panel"><div class="panel-title">Employees</div>' +
      (staffRows || '<div class="empty">No employees added yet.</div>') +
      '<div class="row" style="margin-top:12px;">' +
        '<div class="field"><label>Name</label><input id="staffName" placeholder="Full name"></div>' +
        '<div class="field"><label>Badge ID (goes on the barcode)</label><input id="staffId" placeholder="OP-101"></div>' +
        '<div class="field"><label>Hall</label><select id="staffHall" onchange="onHallSelect(\'staffHall\',\'staffHallNewWrap\')">' + hallOptions('', true) + '</select></div>' +
      '</div>' +
      '<div class="row" id="staffHallNewWrap" style="display:none;margin-top:8px;"><div class="field"><label>New hall name</label><input id="staffHallNew" placeholder="2 Wheeler"></div></div>' +
      '<div style="margin-top:10px;"><button class="btn" onclick="addStaff()">Add employee</button></div>' +
      '<p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">The card below shows the name in bold and the badge ID underneath. If they look swapped, remove and re-add.</p>' +
    '</div>' +
    '<div class="panel"><div class="panel-title">Stations (order = line sequence, grouped by hall)</div>' +
      (stationRows || '<div class="empty">No stations added yet.</div>') +
      '<div class="row" style="margin-top:12px;">' +
        '<div class="field"><label>New station name</label><input id="stationName" placeholder="Spot"></div>' +
        '<div class="field"><label>Code (scanner prefix)</label><input id="stationCode" placeholder="SPOT2W"></div>' +
        '<div class="field"><label>Hall</label><select id="stationHall" onchange="onHallSelect(\'stationHall\',\'stationHallNewWrap\')">' + hallOptions('', true) + '</select></div>' +
      '</div>' +
      '<div class="row" id="stationHallNewWrap" style="display:none;margin-top:8px;"><div class="field"><label>New hall name</label><input id="stationHallNew" placeholder="Prismatic"></div></div>' +
      '<div style="margin-top:10px;"><button class="btn" onclick="addStation()">Add station</button></div>' +
      '<p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">Har station ka ek unique Code hota hai jo scanner prefix ki tarah bhejta hai. Station naam alag-alag halls mein same ho sakte hain, Code nahi.</p>' +
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

function setLabelHall(v) {
  state.labelHall = v;
  state.labelPick = '';          // hall badla to model reset
  renderContentOnly();
}

function setLabelModel(v) {
  state.labelPick = v;
  state.labelCellOpt = 'Main';
  state.labelBmsOpt = 'Main';
  renderContentOnly();
}

function setLabelOpt(kind, v) {
  if (kind === 'cell') state.labelCellOpt = v; else state.labelBmsOpt = v;
}

function generateSerials() {
  var qty = parseInt(document.getElementById('labelQty').value, 10);
  var model = state.labelPick;
  var hallEl = document.getElementById('labelHall');
  var hall = hallEl ? hallEl.value : '';
  var cellEl = document.getElementById('labelCellOpt');
  var bmsEl = document.getElementById('labelBmsOpt');
  var cellOpt = cellEl && !cellEl.disabled ? cellEl.value : '';
  var bmsOpt = bmsEl && !bmsEl.disabled ? bmsEl.value : '';
  if (!hall) { alert('Pehle hall chuno.'); return; }
  if (!model) { alert('Pehle model chuno.'); return; }
  if (!cellOpt) { alert('Is model ka cell Master BOM me nahi hai. Pehle Master me daalo.'); return; }
  if (!bmsOpt) { alert('Is model ka BMS Master BOM me nahi hai. Pehle Master me daalo.'); return; }
  if (!qty || qty < 1) { alert('Enter how many batteries you need labels for.'); return; }
  if (qty > 200) { alert('Maximum 200 at a time.'); return; }

  var btn = document.getElementById('genBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

  call('newSerials', { qty: qty, model: model, hall: hall, cellOpt: cellOpt, bmsOpt: bmsOpt }).then(function (res) {
    state.labels = res.serials || [];
    state.labelModel = res.model || '';
    state.labelCellOpt = 'Main';
    state.labelBmsOpt = 'Main';
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
  var selModel = null;
  state.models.forEach(function (m) { if (m.code === state.labelPick) selModel = m; });

  // Hall list = PLT ke halls + Master ki categories
  var hallList = state.halls.slice();
  state.models.forEach(function (m) {
    if (m.category && hallList.indexOf(m.category) < 0) hallList.push(m.category);
  });

  var hallField = '';
  if (hallList.length) {
    var hopts = '<option value="">-- hall chuno --</option>' + hallList.map(function (hn) {
      return '<option value="' + esc(hn) + '"' + (state.labelHall === hn ? ' selected' : '') + '>' + esc(hn) + '</option>';
    }).join('');
    hallField = '<div class="field"><label>Hall</label><select id="labelHall" onchange="setLabelHall(this.value)">' +
                hopts + '</select></div>';
  }

  var modelField;
  if (state.models.length) {
    var hk = String(state.labelHall || '').trim().toLowerCase();
    var shown = state.models.filter(function (m) {
      return !hk || String(m.category || '').trim().toLowerCase() === hk;
    });
    var opts = '<option value="">-- pick a model --</option>' + shown.map(function (m) {
      return '<option value="' + esc(m.code) + '"' + (state.labelPick === m.code ? ' selected' : '') + '>' +
             esc(m.name) + ' (' + esc(m.code) + ')</option>';
    }).join('');
    modelField = hallField +
                 '<div class="field"><label>Model</label><select id="labelModel" onchange="setLabelModel(this.value)">' +
                 opts + '</select></div>';
  } else {
    modelField = '<div class="field"><label>Model</label>' +
      '<div style="font-size:13px;color:var(--danger);padding:9px 0;">' +
      esc(state.modelsError || 'Master Sheet me koi active model nahi mila jiska SerialPrefix bhara ho.') +
      '</div></div>';
  }

  // Cell / BMS dropdown — Master BOM ke Main/Backup
  var optSelect = function (id, list, cur, kind, withQty) {
    if (!selModel) return '<select id="' + id + '" disabled><option>-- pehle model chuno --</option></select>';
    if (!list.length) {
      return '<select id="' + id + '" disabled><option>Master BOM me ' + kind + ' nahi hai</option></select>';
    }
    return '<select id="' + id + '" onchange="setLabelOpt(\'' + kind + '\', this.value)">' + list.map(function (o) {
      return '<option value="' + esc(o.opt) + '"' + (cur === o.opt ? ' selected' : '') + '>' +
             esc(o.item) + (withQty ? ' ×' + o.qty : '') + ' (' + esc(o.opt) + ')</option>';
    }).join('') + '</select>';
  };
  var cellField = '<div class="field"><label>Cells used</label>' +
    optSelect('labelCellOpt', selModel ? (selModel.cellOptions || []) : [], state.labelCellOpt, 'cell', true) + '</div>';
  var bmsField = '<div class="field"><label>BMS used</label>' +
    optSelect('labelBmsOpt', selModel ? (selModel.bmsOptions || []) : [], state.labelBmsOpt, 'BMS', false) + '</div>';

  var head = '<div class="panel"><div class="panel-title">New battery labels</div>' +
    '<p style="color:var(--text-muted);font-size:13.5px;margin-top:-6px;">Model, Cells aur BMS <b>Master Sheet</b> se aate hain. ' +
    'Normal me <b>Main</b> rakho; Main stock me na ho to <b>Backup</b> chuno. Jo chuna, wahi har serial ke saath save hota hai.</p>' +
    '<div class="row" style="max-width:960px;">' +
      modelField + cellField + bmsField +
      '<div class="field"><label>How many batteries</label>' +
      '<input id="labelQty" type="number" min="1" max="200" value="10" ' +
      'onkeydown="if(event.key===\'Enter\') generateSerials();"></div>' +
    '</div>' +
    '<div style="margin-top:10px;"><button class="btn" id="genBtn" onclick="generateSerials()"' +
      (selModel ? '' : ' disabled') + '>Generate serials</button></div>' +
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
             '<div class="qt"><div class="qt-brand">' + esc(state.labelModel || 'LITPAX') + '</div>' +
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

/* ---------------- Manual Entry (Task 0) ---------------- */

state.sup = { token: '', plans: [], warn: '', today: [], pick: '', loaded: false, loading: false, busy: false };
try { state.sup.token = sessionStorage.getItem('plt_sup') || ''; } catch (e) {}

function supByVal() { try { return localStorage.getItem('plt_sup_by') || ''; } catch (e) { return ''; } }
function supBy() {
  var el = document.getElementById('supBy');
  var v = el ? el.value.trim() : '';
  try { localStorage.setItem('plt_sup_by', v); } catch (e) {}
  return v;
}

function supLogout() {
  state.sup.token = ''; state.sup.loaded = false; state.sup.plans = []; state.sup.today = []; state.sup.pick = '';
  try { sessionStorage.removeItem('plt_sup'); } catch (e) {}
  renderContentOnly();
}

function supErr(err) {
  var m = (err && err.message) || String(err);
  alert(m);
  if (/login|session/i.test(m)) supLogout();
}

function supLogin() {
  var el = document.getElementById('supPin');
  var pin = el ? el.value.trim() : '';
  if (!pin) { alert('PIN daalo'); return; }
  call('supLogin', { pin: pin }).then(function (res) {
    state.sup.token = res.token;
    try { sessionStorage.setItem('plt_sup', res.token); } catch (e) {}
    state.sup.loaded = false;
    renderContentOnly();
  }, function (err) { alert(err.message); });
}

function supLoad() {
  if (!state.sup.token || state.sup.loading) return;
  state.sup.loading = true;
  call('pendingPlans', { token: state.sup.token }).then(function (r1) {
    state.sup.plans = r1.plans || [];
    state.sup.warn = r1.warn || '';
    return call('todayCompletions', { token: state.sup.token });
  }).then(function (r2) {
    state.sup.today = (r2 && r2.rows) || [];
    state.sup.loaded = true; state.sup.loading = false;
    if (state.tab === 'manual') renderContentOnly();
  }, function (err) {
    state.sup.loading = false; state.sup.loaded = true;
    supErr(err);
  });
}

function supRefresh() { state.sup.loaded = false; renderContentOnly(); }
function supPickPlan(id) { state.sup.pick = id; renderContentOnly(); }

/* Mode A — 10-10 ke batch me bhejta hai, taaki scanner ka lock zyada der na ruke */
function supBulk() {
  if (state.sup.busy) return;
  var pl = state.sup.plans.filter(function (p) { return p.planId === state.sup.pick; })[0];
  if (!pl) { alert('Pehle upar se plan chuno'); return; }
  var qty = parseInt(document.getElementById('supQty').value, 10) || 0;
  var worker = document.getElementById('supWorkerA').value;
  var by = supBy();
  if (!by) { alert('Entered By naam daalo'); return; }
  if (qty < 1) { alert('Qty daalo'); return; }
  if (qty > pl.pending) { alert('Is plan me sirf ' + pl.pending + ' pending hai'); return; }
  if (qty > pl.available) { alert(pl.model + ' ke sirf ' + pl.available + ' serial bache hain — pehle labels generate karo'); return; }
  if (!confirm(pl.planId + ' (' + pl.model + ') — ' + qty + ' battery Complete mark karein?')) return;

  state.sup.busy = true;
  var btn = document.getElementById('supBulkBtn');
  var left = qty, doneAll = [], skippedAll = [];

  function finish(err) {
    state.sup.busy = false;
    var m = doneAll.length + ' battery Complete ho gayi.';
    if (skippedAll.length) m += '\n\nSkip hui:\n' + skippedAll.join('\n');
    if (err) m += '\n\nRuk gaya: ' + err.message;
    alert(m);
    if (err && /login|session/i.test(err.message)) { supLogout(); return; }
    state.sup.loaded = false;
    renderContentOnly();
  }

  function next() {
    if (left <= 0) { finish(); return; }
    var n = Math.min(10, left);
    if (btn) { btn.disabled = true; btn.textContent = 'Saving... ' + doneAll.length + '/' + qty; }
    call('manualComplete', {
      token: state.sup.token, planId: pl.planId, qty: n, enteredBy: by, workerId: worker
    }).then(function (res) {
      doneAll = doneAll.concat(res.completed || []);
      skippedAll = skippedAll.concat(res.skipped || []);
      left -= n;
      if ((res.skipped || []).length) left = 0;      // hall set nahi to aage mat badho
      next();
    }, function (err) { finish(err); });
  }
  next();
}

/* Mode B — ek serial, ek station */
function supSerial() {
  var serial = document.getElementById('supSerial').value.trim();
  var station = document.getElementById('supStation').value;
  var worker = document.getElementById('supWorkerB').value;
  var by = supBy();
  if (!by) { alert('Entered By naam daalo'); return; }
  if (!serial || !station || !worker) { alert('Serial, Station aur Worker teeno chahiye'); return; }
  call('manualScan', {
    token: state.sup.token, serial: serial, station: station, workerId: worker, enteredBy: by
  }).then(function () {
    alert('Saved: ' + serial + ' @ ' + station);
    state.sup.loaded = false;
    renderContentOnly();
  }, supErr);
}

function supUndo(serial) {
  var by = supBy();
  if (!by) { alert('Entered By naam daalo'); return; }
  if (!confirm('Undo Complete: ' + serial + ' ?\nBattery wapas "In progress" ho jayegi.')) return;
  call('undoComplete', { token: state.sup.token, serial: serial, enteredBy: by })
    .then(function () { state.sup.loaded = false; renderContentOnly(); }, supErr);
}

function renderManual() {
  var s = state.sup;

  if (!s.token) {
    return '<div class="panel" style="max-width:420px;"><div class="panel-title">Supervisor login</div>' +
      '<p style="color:var(--text-muted);font-size:13.5px;margin-top:-6px;">Manual Entry sirf supervisor ke liye hai.</p>' +
      '<div class="field"><label>Supervisor PIN</label>' +
      '<input id="supPin" type="password" onkeydown="if(event.key===\'Enter\')supLogin()"></div>' +
      '<div style="margin-top:10px;"><button class="btn" onclick="supLogin()">Login</button></div></div>';
  }

  if (!s.loaded) { setTimeout(supLoad, 10); return '<div class="empty">Loading plans...</div>'; }

  var workerOpts = function (optional) {
    return '<option value="">' + (optional ? '-- (optional) --' : '-- worker chuno --') + '</option>' +
      state.staff.map(function (w) {
        return '<option value="' + esc(w.id) + '">' + esc(w.name) + ' (' + esc(w.id) + ')' +
               (w.hall ? ' · ' + esc(w.hall) : '') + '</option>';
      }).join('');
  };
  var stationOpts = '<option value="">-- station chuno --</option>' + state.stationRows.map(function (r) {
    return '<option value="' + esc(r.name) + '">' + esc(r.name) + (r.hall ? ' · ' + esc(r.hall) : '') +
           (r.complete ? ' (Complete)' : '') + '</option>';
  }).join('');

  var top = '<div class="panel"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">' +
    '<div class="field" style="min-width:220px;"><label>Entered By (aapka naam)</label>' +
    '<input id="supBy" value="' + esc(supByVal()) + '" placeholder="Supervisor naam"></div>' +
    '<button class="btn secondary" onclick="supRefresh()">Refresh</button>' +
    '<button class="btn secondary" onclick="supLogout()">Logout</button></div></div>';

  // Mode A
  var planRows = s.plans.map(function (p) {
    var on = s.pick === p.planId;
    return '<tr style="cursor:pointer;' + (on ? 'background:rgba(99,102,241,.10);' : '') + '" ' +
      'data-p="' + esc(p.planId) + '" onclick="supPickPlan(this.dataset.p)">' +
      '<td><input type="radio"' + (on ? ' checked' : '') + '></td>' +
      '<td class="mono">' + esc(p.planId) + '</td><td>' + esc(p.date) + '</td>' +
      '<td class="mono">' + esc(p.orderId) + '</td><td>' + esc(p.customer) + '</td>' +
      '<td>' + esc(p.model) + '</td><td class="mono">' + p.planned + '</td>' +
      '<td class="mono">' + p.done + '</td><td class="mono"><b>' + p.pending + '</b></td>' +
      '<td class="mono"' + (p.available < p.pending ? ' style="color:var(--danger);"' : '') + '>' + p.available + '</td></tr>';
  }).join('');

  var modeA = '<div class="panel"><div class="panel-title">A · Bulk Complete (plan-wise)</div>' +
    (s.warn ? '<div style="color:var(--danger);font-size:13px;margin-bottom:8px;">⚠ ' + esc(s.warn) + '</div>' : '') +
    (s.plans.length
      ? '<div class="table-wrap"><table><thead><tr><th></th><th>Plan</th><th>Date</th><th>Order</th><th>Customer</th>' +
        '<th>Model</th><th>Planned</th><th>Done</th><th>Pending</th><th>Serial bache</th></tr></thead><tbody>' +
        planRows + '</tbody></table></div>'
      : '<div class="empty">Koi pending plan nahi.</div>') +
    '<div class="row" style="margin-top:12px;max-width:640px;">' +
      '<div class="field"><label>Kitni bani</label><input id="supQty" type="number" min="1" value="1"></div>' +
      '<div class="field"><label>Worker</label><select id="supWorkerA">' + workerOpts(true) + '</select></div>' +
    '</div>' +
    '<div style="margin-top:10px;"><button class="btn" id="supBulkBtn" onclick="supBulk()"' +
      (s.pick ? '' : ' disabled') + '>Complete mark karo</button></div>' +
    '<p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">Us plan ke model ke sabse purane bache serials ' +
    'Complete honge aur plan se jud jayenge. "Serial bache" kam ho to pehle Battery Labels se generate karo.</p></div>';

  // Mode B
  var modeB = '<div class="panel"><div class="panel-title">B · Serial-wise (scan miss ho gaya ho)</div>' +
    '<div class="row" style="max-width:860px;">' +
      '<div class="field"><label>Serial</label><input id="supSerial" placeholder="LP-6040-00001"></div>' +
      '<div class="field"><label>Station</label><select id="supStation">' + stationOpts + '</select></div>' +
      '<div class="field"><label>Worker</label><select id="supWorkerB">' + workerOpts(false) + '</select></div>' +
    '</div>' +
    '<div style="margin-top:10px;"><button class="btn" onclick="supSerial()">Save</button></div></div>';

  // Aaj ke Completions
  var todayRows = s.today.map(function (r) {
    var src = r.source === 'Manual' ? '<span class="badge pending">Manual</span>' : '<span class="badge pass">Scanner</span>';
    var st = r.status === 'Active' ? '<span class="badge pass">Active</span>' : '<span class="badge fail">' + esc(r.status) + '</span>';
    var act = r.status === 'Active'
      ? '<button class="icon-btn danger" data-s="' + esc(r.serial) + '" onclick="supUndo(this.dataset.s)">Undo</button>' : '';
    return '<tr><td class="mono">' + esc(r.time) + '</td><td class="mono">' + esc(r.serial) + '</td>' +
      '<td>' + esc(r.model) + '</td><td class="mono">' + esc(r.planId || '—') + '</td>' +
      '<td class="mono">' + esc(r.orderId || '—') + '</td><td>' + src + '</td><td>' + esc(r.by || '—') + '</td>' +
      '<td>' + st + '</td><td>' + act + '</td></tr>';
  }).join('');

  var today = '<div class="panel"><div class="panel-title">Aaj complete hui batteries (' + s.today.length + ')</div>' +
    (s.today.length
      ? '<div class="table-wrap"><table><thead><tr><th>Time</th><th>Serial</th><th>Model</th><th>Plan</th>' +
        '<th>Order</th><th>Source</th><th>Entered By</th><th>Status</th><th></th></tr></thead><tbody>' +
        todayRows + '</tbody></table></div>'
      : '<div class="empty">Aaj abhi koi battery complete nahi hui.</div>') + '</div>';

  return top + modeA + modeB + today;
}

/* ---------------- Shell ---------------- */

function renderTabs() {
  var el = document.getElementById('tabs');
  if (!state.unlocked) { el.innerHTML = ''; return; }
  var tabs = [['dashboard', 'Dashboard'], ['employees', 'Employees'], ['labels', 'Battery Labels'],
              ['manual', 'Manual Entry'], ['setup', 'Setup'], ['cards', 'Print Cards']];
  el.innerHTML = tabs.map(function (t) {
    return '<button class="tab ' + (state.tab === t[0] ? 'active' : '') + '" onclick="setTab(\'' + t[0] + '\')">' + t[1] + '</button>';
  }).join('');
}

function renderContextBar() {
  var el = document.getElementById('contextBar');
  el.innerHTML = '<div class="context-pill floor">' + esc(CONFIG.FLOOR || 'NO FLOOR') + '</div>';
}

function renderContentOnly() {
  var c = document.getElementById('content');
  if (state.tab === 'dashboard') c.innerHTML = renderDashboard();
  else if (state.tab === 'employees') c.innerHTML = renderEmployees();
  else if (state.tab === 'setup') c.innerHTML = renderSetup();
  else if (state.tab === 'labels') { c.innerHTML = renderLabels(); setTimeout(drawLabels, 30); }
  else if (state.tab === 'cards') { c.innerHTML = renderCards(); setTimeout(drawBarcodes, 30); }
  else if (state.tab === 'manual') c.innerHTML = renderManual();
}

function render() {
  renderTabs();
  renderContextBar();
  updateConn();
  var c = document.getElementById('content');

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

render();

// No PIN gate - just fetch settings and load.
call('settings', {}).then(function (res) {
  applySettings(res.settings);
  render();
  loadAll();
  if (CONFIG.POLL_MS) setInterval(refreshAll, Math.max(CONFIG.POLL_MS, 20000));
}, function (err) {
  state.statusMsg = err.message;
  render();
});
