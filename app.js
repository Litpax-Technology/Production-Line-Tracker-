/* Pack Line Tracker - frontend logic
   Talks to Apps Script over JSONP. All settings live in config.js. */

var state = {
  tab: 'scan',
  staff: [],
  stations: [],
  packs: {},          // packId -> { id, currentStage, status, history[] }
  viewPacks: [],      // filtered list currently rendered on dashboard
  loading: true,
  currentStation: '',
  operator: null,
  lastScan: null,     // { packId, entryIndex }
  recentScans: [],
  expandedPack: null,
  search: '',
  connected: true,
  pending: 0,         // in-flight writes
  statusMsg: ''
};

/* ------------------------------------------------------------------ */
/* JSONP transport                                                     */
/* ------------------------------------------------------------------ */

var jsonpSeq = 0;

function jsonp(params) {
  return new Promise(function (resolve, reject) {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
      reject(new Error('API_URL not set in config.js'));
      return;
    }
    var cb = '__plt_cb_' + Date.now() + '_' + (jsonpSeq++);
    var script = document.createElement('script');
    var done = false;

    var timer = setTimeout(function () {
      cleanup();
      reject(new Error('Request timed out'));
    }, CONFIG.TIMEOUT_MS || 20000);

    function cleanup() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cb] = function (res) {
      cleanup();
      state.connected = true;
      if (res && res.ok === false) reject(new Error(res.error || 'Request failed'));
      else resolve(res || {});
    };

    script.onerror = function () {
      cleanup();
      state.connected = false;
      reject(new Error('Network error - check the deployment URL'));
    };

    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    script.src = CONFIG.API_URL + '?' + qs + '&callback=' + cb + '&_=' + Date.now();
    document.body.appendChild(script);
  });
}

function call(action, params) {
  var p = params || {};
  p.action = action;
  p.floor = CONFIG.FLOOR || '';
  state.pending++;
  updateConn();
  return jsonp(p).then(function (res) {
    state.pending--;
    state.connected = true;
    updateConn();
    return res;
  }, function (err) {
    state.pending--;
    updateConn();
    throw err;
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(ts) {
  var d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function badgeClassFor(v) {
  if (v === 'pass') return 'pass';
  if (v === 'fail') return 'fail';
  if (v === 'rework') return 'pending';
  return 'progress';
}

function updateConn() {
  var dot = document.getElementById('connDot');
  var txt = document.getElementById('connText');
  if (!dot || !txt) return;
  if (!state.connected) {
    dot.className = 'conn-dot off';
    txt.textContent = 'Not connected - scans are held locally, check the URL in config.js';
  } else if (state.pending > 0) {
    dot.className = 'conn-dot busy';
    txt.textContent = 'Saving to Sheet... (' + state.pending + ')';
  } else {
    dot.className = 'conn-dot';
    txt.textContent = 'Connected - ' + (CONFIG.FLOOR || 'no floor set');
  }
}

function flash(cls) {
  var box = document.getElementById('scanBox');
  if (!box) return;
  box.classList.add(cls);
  setTimeout(function () { box.classList.remove(cls); }, 400);
}

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

function buildPacks(logs) {
  var packs = {};
  logs.sort(function (a, b) { return a[0] - b[0]; });
  logs.forEach(function (r) {
    var packId = r[2];
    if (!packs[packId]) packs[packId] = { id: packId, currentStage: r[3], status: 'pending', history: [] };
    packs[packId].history.push({
      station: r[3], operatorId: r[4], operatorName: r[5],
      timestamp: r[0], result: r[6] || 'pending', synced: true
    });
    packs[packId].currentStage = r[3];
    packs[packId].status = r[6] || 'pending';
  });
  return packs;
}

function loadAll() {
  return call('init', { limit: CONFIG.LOG_LIMIT || 3000 }).then(function (res) {
    state.staff = res.staff || [];
    state.stations = res.stations || [];
    state.packs = buildPacks(res.logs || []);
    state.loading = false;
    render();
  }, function (err) {
    state.loading = false;
    state.statusMsg = err.message;
    render();
  });
}

function refreshPacks() {
  if (state.pending > 0) return;              // don't clobber an in-flight write
  call('init', { limit: CONFIG.LOG_LIMIT || 3000 }).then(function (res) {
    state.staff = res.staff || [];
    state.stations = res.stations || [];
    state.packs = buildPacks(res.logs || []);
    if (state.tab === 'dashboard') render();
  }, function () { /* silent - dot already shows the state */ });
}

/* ------------------------------------------------------------------ */
/* Scanning                                                            */
/* ------------------------------------------------------------------ */

function sequenceWarning(packId, station) {
  if (!CONFIG.ENFORCE_SEQUENCE) return false;
  var idx = state.stations.indexOf(station);
  if (idx < 0) return false;
  var pack = state.packs[packId];
  var lastIdx = -1;
  if (pack) {
    pack.history.forEach(function (h) {
      var i = state.stations.indexOf(h.station);
      if (i > lastIdx) lastIdx = i;
    });
  }
  if (idx === lastIdx + 1) return false;
  var expected = state.stations[lastIdx + 1] || 'end of line';
  return 'Out of sequence.\n\nPack: ' + packId + '\nExpected next: ' + expected +
         '\nScanned at: ' + station + '\n\nLog it anyway?';
}

function handleUniversalScan(raw) {
  var code = String(raw || '').trim();
  if (!code) return;
  var upper = code.toUpperCase();

  // Station card
  if (upper.indexOf('STATION:') === 0) {
    var stName = code.substring(8).trim();
    var stMatch = null;
    state.stations.forEach(function (s) { if (s.toLowerCase() === stName.toLowerCase()) stMatch = s; });
    if (!stMatch) { flash('flash-error'); alert('Unknown station card: ' + stName); return; }
    state.currentStation = stMatch;
    flash('flash-context');
    render();
    return;
  }

  // Staff badge
  if (upper.indexOf('STAFF:') === 0) {
    var badge = code.substring(6).trim();
    var opMatch = null;
    state.staff.forEach(function (s) { if (s.id.toLowerCase() === badge.toLowerCase()) opMatch = s; });
    if (!opMatch) { flash('flash-error'); alert('Badge not recognized: ' + badge); return; }
    state.operator = opMatch;
    flash('flash-context');
    render();
    return;
  }

  // Pack scan
  if (!state.currentStation) { flash('flash-error'); alert('Scan a station card first (or pick one below).'); return; }
  if (!state.operator) { flash('flash-error'); alert('Scan your badge first (or pick your name below).'); return; }

  var warn = sequenceWarning(code, state.currentStation);
  if (warn && !confirm(warn)) { flash('flash-error'); return; }

  // Optimistic local write so the operator is never blocked by network latency
  var ts = Date.now();
  if (!state.packs[code]) state.packs[code] = { id: code, currentStage: state.currentStation, status: 'pending', history: [] };
  var entry = {
    station: state.currentStation,
    operatorId: state.operator.id,
    operatorName: state.operator.name,
    timestamp: ts, result: 'pending', synced: false, failed: false
  };
  state.packs[code].history.push(entry);
  state.packs[code].currentStage = state.currentStation;
  state.packs[code].status = 'pending';

  state.lastScan = { packId: code, entryIndex: state.packs[code].history.length - 1 };
  state.recentScans.unshift({ packId: code, station: state.currentStation, operator: state.operator.name, time: ts, entry: entry });
  state.recentScans = state.recentScans.slice(0, 30);

  flash('flash');
  render();

  call('scan', {
    packId: code, station: entry.station,
    operatorId: entry.operatorId, operatorName: entry.operatorName
  }).then(function () {
    entry.synced = true;
    render();
  }, function (err) {
    entry.failed = true;
    render();
    alert('Scan NOT saved to the Sheet: ' + err.message + '\n\nPack: ' + code + '\nUse Retry Failed on the Scan tab once the connection is back.');
  });
}

function retryFailed() {
  var jobs = [];
  Object.keys(state.packs).forEach(function (pid) {
    state.packs[pid].history.forEach(function (h) {
      if (h.failed && !h.synced) jobs.push({ packId: pid, entry: h });
    });
  });
  if (!jobs.length) { alert('Nothing to retry.'); return; }

  var chain = Promise.resolve();
  jobs.forEach(function (j) {
    chain = chain.then(function () {
      return call('scan', {
        packId: j.packId, station: j.entry.station,
        operatorId: j.entry.operatorId, operatorName: j.entry.operatorName
      }).then(function () {
        j.entry.synced = true; j.entry.failed = false;
      }, function () { /* leave it flagged */ });
    });
  });
  chain.then(function () {
    render();
    var left = 0;
    Object.keys(state.packs).forEach(function (pid) {
      state.packs[pid].history.forEach(function (h) { if (h.failed && !h.synced) left++; });
    });
    alert(left ? (left + ' scan(s) still failing.') : 'All pending scans saved.');
  });
}

function failedCount() {
  var n = 0;
  Object.keys(state.packs).forEach(function (pid) {
    state.packs[pid].history.forEach(function (h) { if (h.failed && !h.synced) n++; });
  });
  return n;
}

function setResult(result) {
  if (!state.lastScan) return;
  var pack = state.packs[state.lastScan.packId];
  if (!pack) return;
  var entry = pack.history[state.lastScan.entryIndex];
  var prev = entry.result;
  entry.result = result;
  pack.status = result;
  render();

  call('result', { packId: state.lastScan.packId, result: result }).then(null, function (err) {
    entry.result = prev;
    pack.status = prev;
    render();
    alert('Could not save result: ' + err.message);
  });
}

/* ------------------------------------------------------------------ */
/* Setup actions                                                       */
/* ------------------------------------------------------------------ */

function addStaff() {
  var nameEl = document.getElementById('staffName');
  var idEl = document.getElementById('staffId');
  var name = nameEl.value.trim(), id = idEl.value.trim();
  if (!name || !id) { alert('Name and Badge ID both required.'); return; }
  call('addStaff', { id: id, name: name }).then(function () {
    state.staff.push({ id: id, name: name });
    nameEl.value = ''; idEl.value = '';
    render();
  }, function (err) { alert(err.message); });
}

function removeStaffAt(i) {
  var s = state.staff[i];
  if (!s || !confirm('Remove ' + s.name + '?')) return;
  call('delStaff', { id: s.id }).then(function () {
    state.staff.splice(i, 1);
    if (state.operator && state.operator.id === s.id) state.operator = null;
    render();
  }, function (err) { alert(err.message); });
}

function addStation() {
  var el = document.getElementById('stationName');
  var name = el.value.trim();
  if (!name) return;
  call('addStation', { name: name }).then(function () {
    state.stations.push(name);
    el.value = '';
    render();
  }, function (err) { alert(err.message); });
}

function removeStationAt(i) {
  var s = state.stations[i];
  if (!s || !confirm('Remove station "' + s + '"? Past scan history is not deleted.')) return;
  call('delStation', { name: s }).then(function () {
    state.stations.splice(i, 1);
    if (state.currentStation === s) state.currentStation = '';
    render();
  }, function (err) { alert(err.message); });
}

function moveStation(i, dir) {
  var j = i + dir;
  if (j < 0 || j >= state.stations.length) return;
  var tmp = state.stations[i];
  state.stations[i] = state.stations[j];
  state.stations[j] = tmp;
  render();
  call('reorderStations', { stations: JSON.stringify(state.stations) }).then(null, function (err) {
    alert('Order not saved: ' + err.message);
    loadAll();
  });
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function exportCSV() {
  var rows = [['Pack ID', 'Station', 'Operator ID', 'Operator', 'Timestamp', 'Result', 'Floor']];
  Object.keys(state.packs).forEach(function (pid) {
    state.packs[pid].history.forEach(function (h) {
      rows.push([pid, h.station, h.operatorId, h.operatorName,
                 new Date(h.timestamp).toISOString(), h.result, CONFIG.FLOOR || '']);
    });
  });
  var csv = rows.map(function (r) {
    return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pack-traceability-' + (CONFIG.FLOOR || 'export') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function setTab(t) { state.tab = t; state.expandedPack = null; render(); }
function manualStation(v) { state.currentStation = v; render(); }
function manualOperator(v) {
  state.operator = null;
  state.staff.forEach(function (s) { if (s.id === v) state.operator = s; });
  render();
}
function setSearch(v) { state.search = v; renderContentOnly(); }
function togglePack(i) {
  var p = state.viewPacks[i];
  if (!p) return;
  state.expandedPack = state.expandedPack === p.id ? null : p.id;
  renderContentOnly();
}

function renderTabs() {
  var tabs = [['scan', 'Scan'], ['dashboard', 'Dashboard'], ['setup', 'Setup'], ['cards', 'Print Cards']];
  document.getElementById('tabs').innerHTML = tabs.map(function (t) {
    return '<button class="tab ' + (state.tab === t[0] ? 'active' : '') + '" onclick="setTab(\'' + t[0] + '\')">' + t[1] + '</button>';
  }).join('');
}

function renderContextBar() {
  var el = document.getElementById('contextBar');
  el.innerHTML =
    '<div class="context-pill floor">' + esc(CONFIG.FLOOR || 'NO FLOOR') + '</div>' +
    (state.currentStation
      ? '<div class="context-pill">STATION: ' + esc(state.currentStation) + '</div>'
      : '<div class="context-pill empty">No station scanned</div>') +
    (state.operator
      ? '<div class="context-pill">OPERATOR: ' + esc(state.operator.name) + '</div>'
      : '<div class="context-pill empty">No operator scanned</div>');
}

function renderScanTab() {
  if (!state.staff.length || !state.stations.length) {
    return '<div class="panel"><div class="empty"><div class="big">Set up staff and stations first</div>' +
           'Open the Setup tab, then print station cards and badges from the Print Cards tab.</div></div>';
  }

  var stOptions = '<option value="">-- pick manually --</option>';
  state.stations.forEach(function (s) {
    stOptions += '<option value="' + esc(s) + '"' + (state.currentStation === s ? ' selected' : '') + '>' + esc(s) + '</option>';
  });
  var opOptions = '<option value="">-- pick manually --</option>';
  state.staff.forEach(function (s) {
    opOptions += '<option value="' + esc(s.id) + '"' + (state.operator && state.operator.id === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
  });

  var lastScanHtml = '';
  if (state.lastScan && state.packs[state.lastScan.packId]) {
    var entry = state.packs[state.lastScan.packId].history[state.lastScan.entryIndex];
    var syncTxt = entry.failed ? '<span class="sync error">NOT SAVED</span>'
                : entry.synced ? '<span class="sync saved">saved</span>'
                : '<span class="sync saving">saving...</span>';
    lastScanHtml =
      '<div class="last-scan">' +
        '<div><div class="id">' + esc(state.lastScan.packId) + '</div>' +
        '<div class="meta">' + esc(entry.station) + ' &middot; ' + esc(entry.operatorName) + ' &middot; ' + fmtTime(entry.timestamp) + ' &middot; ' + syncTxt + '</div></div>' +
        '<div class="qc-btns">' +
          '<button class="qc-btn pass ' + (entry.result === 'pass' ? 'active' : '') + '" onclick="setResult(\'pass\')">Pass</button>' +
          '<button class="qc-btn fail ' + (entry.result === 'fail' ? 'active' : '') + '" onclick="setResult(\'fail\')">Fail</button>' +
          '<button class="qc-btn rework ' + (entry.result === 'rework' ? 'active' : '') + '" onclick="setResult(\'rework\')">Rework</button>' +
        '</div>' +
      '</div>';
  }

  var recentRows = state.recentScans.map(function (r) {
    var mark = r.entry.failed ? '<span class="sync error">!</span>' : r.entry.synced ? '' : '<span class="sync saving">...</span>';
    return '<tr><td class="mono">' + esc(r.packId) + ' ' + mark + '</td><td>' + esc(r.station) +
           '</td><td>' + esc(r.operator) + '</td><td class="mono">' + fmtTime(r.time) + '</td></tr>';
  }).join('');

  var failed = failedCount();
  var retryBar = failed
    ? '<div style="margin-top:12px;"><button class="btn secondary" onclick="retryFailed()">Retry ' + failed + ' Failed Scan(s)</button></div>'
    : '';

  return '<div class="panel">' +
    '<div class="panel-title">Scan Station (one shared PC)</div>' +
    '<p style="color:var(--text-muted);font-size:13px;margin-top:-6px;">Scan a station card, then a badge, then packs. The pills above update automatically. If a card or badge is missing, use the dropdowns instead.</p>' +
    '<div class="scan-box" id="scanBox">' +
      '<input id="universalScan" type="text" placeholder="Scan station card, badge, or pack" autocomplete="off" ' +
      'onkeydown="if(event.key===\'Enter\'){handleUniversalScan(this.value); this.value=\'\';}">' +
      '<div class="scan-hint">Ready to scan</div>' +
      '<div class="scan-readout">' + (state.lastScan ? 'Last pack: ' + esc(state.lastScan.packId) : 'No scans yet') + '</div>' +
    '</div>' +
    '<div class="row">' +
      '<div class="field"><label>Station (manual override)</label><select onchange="manualStation(this.value)">' + stOptions + '</select></div>' +
      '<div class="field"><label>Operator (manual override)</label><select onchange="manualOperator(this.value)">' + opOptions + '</select></div>' +
    '</div>' +
    lastScanHtml + retryBar +
  '</div>' +
  '<div class="panel"><div class="panel-title">Recent Scans (this session)</div>' +
    (state.recentScans.length
      ? '<div class="table-wrap"><table><thead><tr><th>Pack ID</th><th>Station</th><th>Operator</th><th>Time</th></tr></thead><tbody>' + recentRows + '</tbody></table></div>'
      : '<div class="empty">No scans yet.</div>') +
  '</div>';
}

function renderDashboardTab() {
  var packList = Object.keys(state.packs).map(function (k) { return state.packs[k]; });
  var q = state.search.toLowerCase();
  state.viewPacks = packList.filter(function (p) { return !q || p.id.toLowerCase().indexOf(q) >= 0; });

  var count = function (st) { return packList.filter(function (p) { return p.status === st; }).length; };
  var statCards = '<div class="stat-grid">' +
    '<div class="stat-card"><div class="num">' + packList.length + '</div><div class="lbl">Total Packs</div></div>' +
    '<div class="stat-card"><div class="num">' + count('pass') + '</div><div class="lbl">Passed</div></div>' +
    '<div class="stat-card"><div class="num">' + count('fail') + '</div><div class="lbl">Failed</div></div>' +
    '<div class="stat-card"><div class="num">' + count('rework') + '</div><div class="lbl">Rework</div></div>' +
    '</div>';

  var rows = '';
  state.viewPacks.forEach(function (p, i) {
    var last = p.history[p.history.length - 1];
    rows += '<tr style="cursor:pointer" onclick="togglePack(' + i + ')">' +
      '<td class="mono">' + esc(p.id) + '</td>' +
      '<td>' + esc(p.currentStage) + '</td>' +
      '<td>' + esc(last.operatorName) + '</td>' +
      '<td class="mono">' + fmtTime(last.timestamp) + '</td>' +
      '<td><span class="badge ' + badgeClassFor(p.status) + '">' + esc(p.status) + '</span></td>' +
      '</tr>';

    if (state.expandedPack === p.id) {
      var items = p.history.map(function (h, idx) {
        return '<div class="history-item">' +
          '<span class="step-num">' + String(idx + 1) + '</span>' +
          '<span>' + esc(h.station) + '</span>' +
          '<span class="mono">' + esc(h.operatorName) + '</span>' +
          '<span class="mono">' + fmtTime(h.timestamp) + '</span>' +
          '<span class="badge ' + badgeClassFor(h.result) + '">' + esc(h.result) + '</span>' +
          (h.failed ? '<span class="sync error">not saved</span>' : '') +
          '</div>';
      }).join('');
      rows += '<tr><td colspan="5"><div class="history-detail">' + items + '</div></td></tr>';
    }
  });

  return statCards +
    '<div class="panel"><div class="panel-title">All Packs</div>' +
    '<div style="margin-bottom:14px;"><input style="width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:14px;" ' +
    'placeholder="Search pack ID..." oninput="setSearch(this.value)" value="' + esc(state.search) + '"></div>' +
    (state.viewPacks.length
      ? '<div class="table-wrap"><table><thead><tr><th>Pack ID</th><th>Current Stage</th><th>Last Operator</th><th>Last Updated</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty">No packs recorded yet.</div>') +
    (packList.length ? '<div style="margin-top:14px;display:flex;gap:8px;"><button class="btn secondary" onclick="exportCSV()">Export CSV</button>' +
                       '<button class="btn secondary" onclick="refreshPacks()">Refresh</button></div>' : '') +
    '</div>';
}

function renderSetupTab() {
  var staffRows = state.staff.map(function (s, i) {
    return '<div class="list-row"><div><div class="name">' + esc(s.name) + '</div><div class="sub">' + esc(s.id) + '</div></div>' +
           '<button class="icon-btn danger" onclick="removeStaffAt(' + i + ')">X</button></div>';
  }).join('');

  var stationRows = state.stations.map(function (s, i) {
    return '<div class="list-row">' +
      '<div><span class="mono" style="color:var(--accent)">' + String(i + 1) + '</span> &nbsp; <span class="name">' + esc(s) + '</span></div>' +
      '<div style="display:flex;gap:6px;">' +
        '<button class="icon-btn" onclick="moveStation(' + i + ',-1)">Up</button>' +
        '<button class="icon-btn" onclick="moveStation(' + i + ',1)">Dn</button>' +
        '<button class="icon-btn danger" onclick="removeStationAt(' + i + ')">X</button>' +
      '</div></div>';
  }).join('');

  return '<div class="panel"><div class="panel-title">Staff / Operators</div>' +
      (staffRows || '<div class="empty">No staff added yet.</div>') +
      '<div class="row" style="margin-top:12px;">' +
        '<div class="field"><label>Name</label><input id="staffName" placeholder="e.g. operator name"></div>' +
        '<div class="field"><label>Badge / Staff ID</label><input id="staffId" placeholder="e.g. OP-104"></div>' +
      '</div>' +
      '<div style="margin-top:10px;"><button class="btn" onclick="addStaff()">Add Staff Member</button></div>' +
    '</div>' +
    '<div class="panel"><div class="panel-title">Process Stations (order = line sequence)</div>' +
      (stationRows || '<div class="empty">No stations added yet.</div>') +
      '<div class="row" style="margin-top:12px;"><div class="field"><label>New station name</label><input id="stationName" placeholder="e.g. Laser Weld Station 2"></div></div>' +
      '<div style="margin-top:10px;"><button class="btn" onclick="addStation()">Add Station</button></div>' +
    '</div>';
}

function renderCardsTab() {
  return '<div class="panel"><div class="panel-title">Print Station Cards and Staff Badges</div>' +
    '<p style="color:var(--text-muted);font-size:13px;">Print, laminate, place one Station Card at each physical station, and hand each operator their badge. Scanning a card sets the context on the shared PC.</p>' +
    '<button class="btn" onclick="window.print()">Print This Page</button></div>' +
    '<div id="printArea">' +
      '<div class="panel"><div class="panel-title">Station Cards</div><div class="card-grid" id="stationCards"></div></div>' +
      '<div class="panel"><div class="panel-title">Staff Badges</div><div class="card-grid" id="staffCards"></div></div>' +
    '</div>';
}

function drawBarcodes() {
  if (state.tab !== 'cards' || typeof JsBarcode === 'undefined') return;
  var stationEl = document.getElementById('stationCards');
  var staffEl = document.getElementById('staffCards');

  if (stationEl) {
    stationEl.innerHTML = state.stations.map(function (s, i) {
      return '<div class="print-card"><div class="label">' + esc(s) + '</div><svg id="stc' + i + '"></svg></div>';
    }).join('');
    state.stations.forEach(function (s, i) {
      JsBarcode('#stc' + i, 'STATION:' + s, { format: 'CODE128', width: 2, height: 60, displayValue: false });
    });
  }
  if (staffEl) {
    staffEl.innerHTML = state.staff.map(function (s, i) {
      return '<div class="print-card"><div class="label">' + esc(s.name) + '</div><svg id="stfc' + i + '"></svg></div>';
    }).join('');
    state.staff.forEach(function (s, i) {
      JsBarcode('#stfc' + i, 'STAFF:' + s.id, { format: 'CODE128', width: 2, height: 60, displayValue: false });
    });
  }
}

function renderContentOnly() {
  var content = document.getElementById('content');
  if (state.tab === 'scan') content.innerHTML = renderScanTab();
  else if (state.tab === 'dashboard') content.innerHTML = renderDashboardTab();
  else if (state.tab === 'setup') content.innerHTML = renderSetupTab();
  else if (state.tab === 'cards') { content.innerHTML = renderCardsTab(); setTimeout(drawBarcodes, 30); }
}

function render() {
  renderTabs();
  renderContextBar();
  updateConn();

  var content = document.getElementById('content');
  if (state.loading) { content.innerHTML = '<div class="empty">Loading from Sheet...</div>'; return; }
  if (state.statusMsg && !state.stations.length && !state.staff.length) {
    content.innerHTML = '<div class="panel"><div class="empty"><div class="big">Could not reach the Sheet</div>' + esc(state.statusMsg) + '</div></div>';
    state.statusMsg = '';
    return;
  }

  renderContentOnly();

  var input = document.getElementById('universalScan');
  if (input && state.tab === 'scan') input.focus();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

render();
loadAll();
if (CONFIG.POLL_MS) setInterval(refreshPacks, CONFIG.POLL_MS);

// Keep focus in the scan box on the Scan tab, so a scanner always lands there.
document.addEventListener('click', function () {
  if (state.tab !== 'scan') return;
  setTimeout(function () {
    var el = document.getElementById('universalScan');
    if (el && document.activeElement && document.activeElement.tagName !== 'SELECT' &&
        document.activeElement.tagName !== 'INPUT') el.focus();
  }, 50);
});
