/* Scan Station - the only page employees see.
   No dashboard, no setup, no reports. Just scanning. */

state = {
  hall: '',                          // set from ?hall= in the URL; '' = show all
  staff: [], stations: [], stationRows: [], packs: {},
  pendingEmp: null, pendingStation: '',   // current in-progress combo
  lastScan: null, recentScans: [],
  loading: true, connected: true, pending: 0, statusMsg: ''
};

(function () {
  try {
    var u = new URLSearchParams(window.location.search);
    state.hall = (u.get('hall') || '').trim();
  } catch (e) {}
})();

/** Keep only items in the active hall. Empty hall on an item = shown everywhere. */
function inHall(itemHall) {
  if (!state.hall) return true;
  if (!itemHall) return true;
  return itemHall.toLowerCase() === state.hall.toLowerCase();
}

/* ---------------- Load ---------------- */

function loadAll() {
  // First pass fetches settings; a second pass pulls logs only if the
  // Settings sheet has out-of-sequence checking switched on.
  return call('init', { limit: 0 }).then(function (res) {
    applySettings(res.settings);
    var rows = res.stationRows || [];
    state.stationRows = rows.filter(function (r) { return inHall(r.hall); });
    state.stations = state.stationRows.map(function (r) { return r.name; });
    state.staff = (res.staff || []).filter(function (s) { return inHall(s.hall); });
    state.loading = false;
    render();
    startPolling();
    if (CONFIG.ENFORCE_SEQUENCE) {
      return call('init', { limit: CONFIG.LOG_LIMIT }).then(function (r2) {
        state.packs = buildPacks(r2.logs || []);
      }, function () {});
    }
  }, function (err) {
    state.loading = false;
    state.statusMsg = err.message;
    render();
  });
}

function startPolling() {
  if (!CONFIG.POLL_MS) return;
  setInterval(refreshLists, Math.max(CONFIG.POLL_MS, 30000));
}

/** Refreshes staff/stations only, so a newly added employee can sign in. */
function refreshLists() {
  if (state.pending > 0) return;
  call('init', { limit: 0 }).then(function (res) {
    applySettings(res.settings);
    var rows = res.stationRows || [];
    state.stationRows = rows.filter(function (r) { return inHall(r.hall); });
    state.stations = state.stationRows.map(function (r) { return r.name; });
    state.staff = (res.staff || []).filter(function (s) { return inHall(s.hall); });
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

/*
 * Per-battery combo scan. Each battery needs three scans in order:
 *   1. Employee badge   (STAFF:<id>  or a plain id that matches a badge)
 *   2. Station card      (STATION:<name> or a plain name that matches a station)
 *   3. Battery serial    (anything else)
 * The employee and station are held only until the battery lands, then the
 * combo resets. Nothing is remembered across batteries, so two people scanning
 * on the same PC can never write into each other's battery.
 */

function beep(ok) {
  try {
    var ctx = beep._c || (beep._c = new (window.AudioContext || window.webkitAudioContext)());
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.start();
    setTimeout(function () { o.stop(); }, ok ? 90 : 220);
  } catch (e) {}
}

function matchStaff(idRaw) {
  var id = String(idRaw).trim().toLowerCase();
  var m = null;
  state.staff.forEach(function (s) { if (s.id.toLowerCase() === id) m = s; });
  return m;
}

function matchStation(nameRaw) {
  var name = String(nameRaw).trim().toLowerCase();
  var m = null;
  state.stations.forEach(function (s) { if (s.toLowerCase() === name) m = s; });
  return m;
}

function resetCombo() {
  state.pendingEmp = null;
  state.pendingStation = '';
}

function handleUniversalScan(raw) {
  var code = String(raw || '').trim();
  if (!code) return;

  // Some Bluetooth scanners send > or ; in place of ':' due to keyboard layout.
  // Normalise any of them right after the STAFF / STATION keyword.
  code = code.replace(/^(STAFF|STATION)\s*[:>;]\s*/i, '$1:');
  var upper = code.toUpperCase();

  // ---- explicit prefixes always win ----
  if (upper.indexOf('STAFF:') === 0) return takeEmployee(code.substring(6).trim());
  if (upper.indexOf('STATION:') === 0) return takeStation(code.substring(8).trim());

  // ---- no prefix: decide by where we are in the combo ----
  // Waiting for an employee: does this match a badge?
  if (!state.pendingEmp) {
    var asEmp = matchStaff(code);
    if (asEmp) return takeEmployee(code);
    // not a badge - maybe they scanned a station or battery too early
    flash('flash-error'); beep(false);
    alert('Scan your BADGE first.\n\n"' + code + '" is not a known employee badge.');
    return;
  }

  // Have employee, waiting for a station: does this match a station?
  if (!state.pendingStation) {
    var asStation = matchStation(code);
    if (asStation) return takeStation(code);
    flash('flash-error'); beep(false);
    alert('Now scan the STATION card.\n\n"' + code + '" is not a known station.');
    return;
  }

  // Have employee + station: this is the battery.
  commitScan(code);
}

function takeEmployee(idRaw) {
  var emp = matchStaff(idRaw);
  if (!emp) { flash('flash-error'); beep(false); alert('Badge not recognized: ' + idRaw); return; }
  state.pendingEmp = emp;
  state.pendingStation = '';        // fresh combo starts at station next
  flash('flash-context'); beep(true); render();
}

function takeStation(nameRaw) {
  if (!state.pendingEmp) {
    flash('flash-error'); beep(false);
    alert('Scan your BADGE first, then the station.');
    return;
  }
  var st = matchStation(nameRaw);
  if (!st) { flash('flash-error'); beep(false); alert('Unknown station card: ' + nameRaw); return; }
  state.pendingStation = st;
  flash('flash-context'); beep(true); render();
}

function commitScan(code) {
  var emp = state.pendingEmp;
  var station = state.pendingStation;

  // Duplicate guard: same battery, same station, already logged this session.
  if (state.packs[code]) {
    var dup = state.packs[code].history.some(function (h) { return h.station === station; });
    if (dup && !confirm('Battery ' + code + ' was already scanned at ' + station +
                        '.\n\nLog it again?')) {
      flash('flash-error'); beep(false);
      resetCombo(); render();
      return;
    }
  }

  var warn = sequenceWarning(code, station);
  if (warn && !confirm(warn)) { flash('flash-error'); beep(false); resetCombo(); render(); return; }

  // Log locally first so the operator is never blocked by network latency.
  var ts = Date.now();
  if (!state.packs[code]) state.packs[code] = { id: code, currentStage: station, status: 'pending', history: [] };
  var entry = {
    station: station, operatorId: emp.id, operatorName: emp.name,
    timestamp: ts, result: 'pending', synced: false, failed: false
  };
  state.packs[code].history.push(entry);
  state.packs[code].currentStage = station;

  state.lastScan = { packId: code, entry: entry };
  state.recentScans.unshift({ packId: code, station: station, operator: emp.name, time: ts, entry: entry });
  state.recentScans = state.recentScans.slice(0, 30);

  // Keep employee + station for the NEXT battery at the same station,
  // so a run of batteries only needs one badge + one station scan.
  // The combo is self-contained per commit; nothing leaks between batteries.
  flash('flash'); beep(true); render();

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

/* ---------------- Manual overrides (for a missing card/badge) ---------------- */

function manualStation(v) { if (v) takeStation(v); }
function manualOperator(v) { if (v) takeEmployee(v); }
function clearCombo() { resetCombo(); render(); }

/* ---------------- Render ---------------- */

function renderContextBar() {
  var step = !state.pendingEmp ? '1' : !state.pendingStation ? '2' : '3';
  document.getElementById('contextBar').innerHTML =
    '<div class="context-pill floor">' + esc(state.hall || CONFIG.FLOOR || 'ALL HALLS') + '</div>' +
    (state.pendingEmp
      ? '<div class="context-pill">EMPLOYEE: ' + esc(state.pendingEmp.name) + '</div>'
      : '<div class="context-pill empty">1. scan badge</div>') +
    (state.pendingStation
      ? '<div class="context-pill">STATION: ' + esc(state.pendingStation) + '</div>'
      : '<div class="context-pill empty">2. scan station</div>');
}

function renderScan() {
  if (!state.staff.length || !state.stations.length) {
    return '<div class="panel"><div class="empty"><div class="big">Nothing set up yet</div>' +
           'Add employees and stations on the admin page, then print the cards.</div></div>';
  }

  var stOptions = '<option value="">-- pick manually --</option>';
  state.stations.forEach(function (s) {
    stOptions += '<option value="' + esc(s) + '"' + (state.pendingStation === s ? ' selected' : '') + '>' + esc(s) + '</option>';
  });
  var opOptions = '<option value="">-- pick manually --</option>';
  state.staff.forEach(function (s) {
    opOptions += '<option value="' + esc(s.id) + '"' + (state.pendingEmp && state.pendingEmp.id === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
  });

  var stepMsg = !state.pendingEmp
    ? 'Step 1 of 3 - scan the EMPLOYEE badge'
    : !state.pendingStation
      ? 'Step 2 of 3 - scan the STATION card'
      : 'Step 3 of 3 - scan the BATTERY (repeats for each battery here)';

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

  var comboReady = state.pendingEmp && state.pendingStation;
  var resetBtn = (state.pendingEmp || state.pendingStation)
    ? '<button class="btn secondary" style="margin-top:10px;" onclick="clearCombo()">Reset (start over)</button>'
    : '';

  return '<div class="panel">' +
      '<div class="scan-box' + (comboReady ? ' ready' : '') + '" id="scanBox">' +
        '<input id="universalScan" type="text" placeholder="' + esc(stepMsg) + '" autocomplete="off" ' +
        'onkeydown="if(event.key===\'Enter\'){handleUniversalScan(this.value); this.value=\'\';}">' +
        '<div class="scan-hint">' + esc(stepMsg) + '</div>' +
        '<div class="scan-readout">' + (state.lastScan ? 'Last battery: ' + esc(state.lastScan.packId) : 'No scans yet') + '</div>' +
      '</div>' +
      resetBtn +
      '<div class="row" style="margin-top:12px;">' +
        '<div class="field"><label>Employee (if badge missing)</label><select onchange="manualOperator(this.value)">' + opOptions + '</select></div>' +
        '<div class="field"><label>Station (if card missing)</label><select onchange="manualStation(this.value)">' + stOptions + '</select></div>' +
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
