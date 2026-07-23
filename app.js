/* Scan Station - the only page employees see.
   No dashboard, no setup, no reports. Just scanning. */

state = {
  staff: [], stations: [], packs: {},
  currentStation: '', operator: null,
  lastScan: null, recentScans: [],
  loading: true, connected: true, pending: 0, statusMsg: ''
};

/* ---------------- Load ---------------- */

function loadAll() {
  // Log rows are only needed when out-of-sequence checking is on.
  var limit = CONFIG.ENFORCE_SEQUENCE ? (CONFIG.LOG_LIMIT || 3000) : 0;
  return call('init', { limit: limit }).then(function (res) {
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

/** Refreshes staff/stations only, so a newly added employee can sign in. */
function refreshLists() {
  if (state.pending > 0) return;
  call('init', { limit: 0 }).then(function (res) {
    state.staff = res.staff || [];
    state.stations = res.stations || [];
  }, function () { /* the dot already shows the state */ });
}

/* ---------------- Scanning ---------------- */

function flash(cls) {
  var box = document.getElementById('scanBox');
  if (!box) return;
  box.classList.add(cls);
  setTimeout(function () { box.classList.remove(cls); }, 400);
}

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
  return 'Out of sequence.\n\nBattery: ' + packId + '\nExpected next: ' + expected +
         '\nScanned at: ' + station + '\n\nLog it anyway?';
}

function handleUniversalScan(raw) {
  var code = String(raw || '').trim();
  if (!code) return;
  var upper = code.toUpperCase();

  if (upper.indexOf('STATION:') === 0) {
    var stName = code.substring(8).trim(), stMatch = null;
    state.stations.forEach(function (s) { if (s.toLowerCase() === stName.toLowerCase()) stMatch = s; });
    if (!stMatch) { flash('flash-error'); alert('Unknown station card: ' + stName); return; }
    state.currentStation = stMatch;
    flash('flash-context'); render();
    return;
  }

  if (upper.indexOf('STAFF:') === 0) {
    var badge = code.substring(6).trim(), opMatch = null;
    state.staff.forEach(function (s) { if (s.id.toLowerCase() === badge.toLowerCase()) opMatch = s; });
    if (!opMatch) { flash('flash-error'); alert('Badge not recognized: ' + badge); return; }
    state.operator = opMatch;
    flash('flash-context'); render();
    return;
  }

  if (!state.currentStation) { flash('flash-error'); alert('Scan a station card first, or pick one below.'); return; }
  if (!state.operator) { flash('flash-error'); alert('Scan your badge first, or pick your name below.'); return; }

  var warn = sequenceWarning(code, state.currentStation);
  if (warn && !confirm(warn)) { flash('flash-error'); return; }

  // Log locally first so the operator is never blocked by network latency.
  var ts = Date.now();
  if (!state.packs[code]) state.packs[code] = { id: code, currentStage: state.currentStation, status: 'pending', history: [] };
  var entry = {
    station: state.currentStation, operatorId: state.operator.id, operatorName: state.operator.name,
    timestamp: ts, result: 'pending', synced: false, failed: false
  };
  state.packs[code].history.push(entry);
  state.packs[code].currentStage = state.currentStation;

  state.lastScan = { packId: code, entry: entry };
  state.recentScans.unshift({ packId: code, station: entry.station, operator: entry.operatorName, time: ts, entry: entry });
  state.recentScans = state.recentScans.slice(0, 30);

  flash('flash'); render();

  call('scan', {
    packId: code, station: entry.station,
    operatorId: entry.operatorId, operatorName: entry.operatorName
  }).then(function () {
    entry.synced = true; render();
  }, function (err) {
    entry.failed = true; render();
    alert('Not saved: ' + err.message + '\n\nBattery: ' + code +
          '\nUse Retry held scans once the connection is back.');
  });
}

function setResult(result) {
  if (!state.lastScan) return;
  var entry = state.lastScan.entry;
  var prev = entry.result;
  entry.result = result;
  render();
  call('result', { packId: state.lastScan.packId, result: result }).then(null, function (err) {
    entry.result = prev; render();
    alert('Could not save the result: ' + err.message);
  });
}

function failedList() {
  var out = [];
  Object.keys(state.packs).forEach(function (pid) {
    state.packs[pid].history.forEach(function (h) { if (h.failed && !h.synced) out.push({ packId: pid, entry: h }); });
  });
  return out;
}

function retryFailed() {
  var jobs = failedList();
  if (!jobs.length) { alert('Nothing to retry.'); return; }
  var chain = Promise.resolve();
  jobs.forEach(function (j) {
    chain = chain.then(function () {
      return call('scan', {
        packId: j.packId, station: j.entry.station,
        operatorId: j.entry.operatorId, operatorName: j.entry.operatorName
      }).then(function () { j.entry.synced = true; j.entry.failed = false; }, function () {});
    });
  });
  chain.then(function () {
    render();
    var left = failedList().length;
    alert(left ? (left + ' scan(s) still failing.') : 'All held scans saved.');
  });
}

/* ---------------- Manual overrides ---------------- */

function manualStation(v) { state.currentStation = v; render(); }
function manualOperator(v) {
  state.operator = null;
  state.staff.forEach(function (s) { if (s.id === v) state.operator = s; });
  render();
}

/* ---------------- Render ---------------- */

function renderContextBar() {
  document.getElementById('contextBar').innerHTML =
    '<div class="context-pill floor">' + esc(CONFIG.FLOOR || 'NO FLOOR') + '</div>' +
    (state.currentStation
      ? '<div class="context-pill">STATION: ' + esc(state.currentStation) + '</div>'
      : '<div class="context-pill empty">No station scanned</div>') +
    (state.operator
      ? '<div class="context-pill">EMPLOYEE: ' + esc(state.operator.name) + '</div>'
      : '<div class="context-pill empty">No employee scanned</div>');
}

function renderScan() {
  if (!state.staff.length || !state.stations.length) {
    return '<div class="panel"><div class="empty"><div class="big">Nothing set up yet</div>' +
           'Add employees and stations on the admin page, then print the cards.</div></div>';
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
  if (state.lastScan) {
    var e = state.lastScan.entry;
    var sync = e.failed ? '<span class="sync error">NOT SAVED</span>'
             : e.synced ? '<span class="sync saved">saved</span>'
             : '<span class="sync saving">saving...</span>';
    lastScanHtml =
      '<div class="last-scan">' +
        '<div><div class="id">' + esc(state.lastScan.packId) + '</div>' +
        '<div class="meta">' + esc(e.station) + ' &middot; ' + esc(e.operatorName) + ' &middot; ' + fmtTime(e.timestamp) + ' &middot; ' + sync + '</div></div>' +
        '<div class="qc-btns">' +
          '<button class="qc-btn pass ' + (e.result === 'pass' ? 'active' : '') + '" onclick="setResult(\'pass\')">Pass</button>' +
          '<button class="qc-btn fail ' + (e.result === 'fail' ? 'active' : '') + '" onclick="setResult(\'fail\')">Fail</button>' +
          '<button class="qc-btn rework ' + (e.result === 'rework' ? 'active' : '') + '" onclick="setResult(\'rework\')">Rework</button>' +
        '</div>' +
      '</div>';
  }

  var rows = state.recentScans.map(function (r) {
    var mark = r.entry.failed ? '<span class="sync error">!</span>'
             : r.entry.synced ? '' : '<span class="sync saving">...</span>';
    return '<tr><td class="mono">' + esc(r.packId) + ' ' + mark + '</td><td>' + esc(r.station) +
           '</td><td>' + esc(r.operator) + '</td><td class="mono">' + fmtTime(r.time) + '</td></tr>';
  }).join('');

  var failed = failedList().length;
  var retryBar = failed
    ? '<div style="margin-top:12px;"><button class="btn secondary" onclick="retryFailed()">Retry ' + failed + ' held scan(s)</button></div>'
    : '';

  return '<div class="panel">' +
      '<div class="scan-box" id="scanBox">' +
        '<input id="universalScan" type="text" placeholder="Scan station card, badge, or battery" autocomplete="off" ' +
        'onkeydown="if(event.key===\'Enter\'){handleUniversalScan(this.value); this.value=\'\';}">' +
        '<div class="scan-hint">Ready to scan</div>' +
        '<div class="scan-readout">' + (state.lastScan ? 'Last battery: ' + esc(state.lastScan.packId) : 'No scans yet') + '</div>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label>Station (manual override)</label><select onchange="manualStation(this.value)">' + stOptions + '</select></div>' +
        '<div class="field"><label>Employee (manual override)</label><select onchange="manualOperator(this.value)">' + opOptions + '</select></div>' +
      '</div>' +
      lastScanHtml + retryBar +
    '</div>' +
    '<div class="panel"><div class="panel-title">Scanned this session</div>' +
      (state.recentScans.length
        ? '<div class="table-wrap"><table><thead><tr><th>Battery</th><th>Station</th><th>Employee</th><th>Time</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">No scans yet.</div>') +
    '</div>';
}

function render() {
  renderContextBar();
  updateConn();
  var content = document.getElementById('content');

  if (state.loading) { content.innerHTML = '<div class="empty">Loading...</div>'; return; }
  if (state.statusMsg && !state.stations.length) {
    content.innerHTML = '<div class="panel"><div class="empty"><div class="big">Could not reach the Sheet</div>' +
                        esc(state.statusMsg) + '</div></div>';
    state.statusMsg = '';
    return;
  }

  content.innerHTML = renderScan();
  var input = document.getElementById('universalScan');
  if (input) input.focus();
}

/* ---------------- Boot ---------------- */

render();
loadAll();
if (CONFIG.POLL_MS) setInterval(refreshLists, Math.max(CONFIG.POLL_MS, 30000));

// A scanner types wherever the focus is, so keep the scan box focused.
document.addEventListener('click', function () {
  setTimeout(function () {
    var el = document.getElementById('universalScan');
    var a = document.activeElement;
    if (el && a && a.tagName !== 'SELECT' && a.tagName !== 'INPUT') el.focus();
  }, 50);
});

// Warn before closing if anything is still unsaved.
window.addEventListener('beforeunload', function (e) {
  if (failedList().length || state.pending > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});
