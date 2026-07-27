/* Scan Station - the only page employees see.
   No dashboard, no setup, no reports. Just scanning. */

state = {
  hall: '',                          // set from ?hall= in the URL; '' = show all
  staff: [], stations: [], stationRows: [], packs: {},
  stationEmp: {}, manualStation: '',   // per-station employee; manual station for prefix-less scans
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

/*
 * PREFIX MODEL. Every scanner carries a fixed station prefix, e.g. "IR:".
 * So each scan is self-contained - the station comes with the scan, nothing
 * is remembered globally. Because of that, two people scanning on the same
 * PC can never corrupt each other's battery.
 *
 * Per station we remember ONLY the current employee (set by a badge scan at
 * that station). Employees are held per-station, so IR's operator and Spot's
 * operator never mix.
 *
 * Scan shapes (prefix is whatever each scanner is set to send):
 *   IR:STAFF:96      badge sign-in at IR      (or IR:96 if it matches a badge)
 *   IR:LP0011        battery at IR
 * Without a prefix the app falls back to a single "manual" station chosen
 * from the dropdown - handy when testing with one scanner.
 */

// current employee per station: { "IR": {id,name}, "Spot": {...} }
state.stationEmp = state.stationEmp || {};
// manual station when a scan has no prefix (single-scanner testing)
state.manualStation = state.manualStation || '';

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

/**
 * Splits a raw scan into { station, rest }.
 * The station comes from the scanner's prefix ("IR:LP0011" -> station IR).
 * Any separator char is tolerated (:, >, ? ...) because of keyboard layout.
 * If the first segment is not a known station, there is no prefix: station
 * falls back to the manual dropdown selection.
 */
function splitScan(raw) {
  var code = String(raw || '').trim();
  // Normalise STAFF/STATION keyword separators too.
  code = code.replace(/^(STAFF|STATION)[^A-Za-z0-9]+/i, function (m, kw) { return kw.toUpperCase() + ':'; });

  // Does it start with "<something><sep>..."? Try to read a station prefix.
  var m = code.match(/^([A-Za-z0-9 ]+?)[^A-Za-z0-9]+(.+)$/);
  if (m) {
    var st = matchStation(m[1]);
    if (st) return { station: st, rest: m[2].trim() };
  }
  // No usable prefix - use the manual station (if any).
  return { station: state.manualStation, rest: code };
}

function handleUniversalScan(raw) {
  var parts = splitScan(raw);
  var station = parts.station;
  var rest = parts.rest;

  if (!station) {
    flash('flash-error'); beep(false);
    alert('No station on this scan.\n\nEither the scanner has no station prefix set, ' +
          'or pick a station below for testing.');
    return;
  }

  // A badge sign-in? Either "STAFF:96" or a bare id that matches a badge.
  var badgeId = rest;
  if (/^STAFF:/i.test(rest)) badgeId = rest.replace(/^STAFF:/i, '').trim();
  var emp = matchStaff(badgeId);
  if (emp) {
    state.stationEmp[station] = emp;
    flash('flash-context'); beep(true); render();
    return;
  }

  // Otherwise it is a battery scan for this station.
  var operator = state.stationEmp[station];
  if (!operator) {
    flash('flash-error'); beep(false);
    alert('No employee signed in at ' + station + '.\n\n' +
          'Scan an employee badge on this scanner first.');
    return;
  }

  commitScan(rest, station, operator);
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

function commitScan(code, station, emp) {
  // Duplicate guard: same battery, same station, already logged this session.
  if (state.packs[code]) {
    var dup = state.packs[code].history.some(function (h) { return h.station === station; });
    if (dup && !confirm('Battery ' + code + ' was already scanned at ' + station +
                        '.\n\nLog it again?')) {
      flash('flash-error'); beep(false); render();
      return;
    }
  }

  var warn = sequenceWarning(code, station);
  if (warn && !confirm(warn)) { flash('flash-error'); beep(false); render(); return; }

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

/* ---------------- Manual controls (single-scanner testing) ---------------- */

// Pick the station a prefix-less scan belongs to.
function setManualStation(v) { state.manualStation = v; render(); }

// Manually sign an employee into the manual station (badge missing).
function manualOperator(v) {
  if (!v) return;
  var st = state.manualStation;
  if (!st) { alert('Pick a station first.'); return; }
  var emp = matchStaff(v);
  if (emp) { state.stationEmp[st] = emp; render(); }
}

/* ---------------- Render ---------------- */

function renderContextBar() {
  document.getElementById('contextBar').innerHTML =
    '<div class="context-pill floor">' + esc(state.hall || CONFIG.FLOOR || 'ALL HALLS') + '</div>';
}

function renderScan() {
  if (!state.staff.length || !state.stations.length) {
    return '<div class="panel"><div class="empty"><div class="big">Nothing set up yet</div>' +
           'Add employees and stations on the admin page, then set each scanner\'s prefix.</div></div>';
  }

  var hint = 'Scan a battery. The scanner prefix sets the station; the badge scanned there is the employee.';

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

  // Live board: one card per station in this hall, showing who is signed in
  // and how many batteries they have scanned this session.
  var sessionCount = {};
  var maxCount = 0;
  state.recentScans.forEach(function (r) {
    var k = r.station + '||' + r.operator;
    sessionCount[k] = (sessionCount[k] || 0) + 1;
    if (sessionCount[k] > maxCount) maxCount = sessionCount[k];
  });

  var boardCards = state.stations.map(function (st) {
    var emp = state.stationEmp[st];
    var count = emp ? (sessionCount[st + '||' + emp.name] || 0) : 0;
    if (emp) {
      var initials = emp.name.trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
      var pct = maxCount ? Math.round(count / maxCount * 100) : 0;
      var lead = (count > 0 && count === maxCount) ? '<span class="board-lead">TOP</span>' : '';
      return '<div class="board-card active">' +
        '<div class="board-station">' + esc(st) + lead + '</div>' +
        '<div class="board-who"><span class="board-avatar">' + esc(initials) + '</span>' +
        '<span class="board-emp">' + esc(emp.name) + '</span></div>' +
        '<div class="board-count">' + count + '<span class="board-count-lbl"> done</span></div>' +
        '<div class="board-bar"><div class="board-bar-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    }
    return '<div class="board-card">' +
      '<div class="board-station">' + esc(st) + '</div>' +
      '<div class="board-emp empty">open</div>' +
    '</div>';
  }).join('');
  var board = '<div class="panel"><div class="panel-title">Who is on each station &middot; live</div>' +
    '<div class="board-grid">' + boardCards + '</div></div>';

  return '<div class="panel scan-panel">' +
      '<div class="scan-box" id="scanBox">' +
        '<input id="universalScan" type="text" placeholder="Scan badge or battery" autocomplete="off" ' +
        'onkeydown="if(event.key===\'Enter\'){handleUniversalScan(this.value); this.value=\'\';}">' +
        '<div class="scan-hint">' + esc(hint) + '</div>' +
        '<div class="scan-readout">' + (state.lastScan ? 'Last battery: ' + esc(state.lastScan.packId) : 'No scans yet') + '</div>' +
      '</div>' +
      lastScanHtml + retryBar +
    '</div>' +
    board +
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
