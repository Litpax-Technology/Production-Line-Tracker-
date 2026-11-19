/* Scan Station - the only page employees see.
   No dashboard, no setup, no reports. Just scanning. */

state = {
  hall: '',                          // set from ?hall= in the URL; '' = show all
  staff: [], stations: [], stationRows: [], packs: {},
  stationEmp: {}, manualStation: '',   // per-station employee; manual station for prefix-less scans
  lastScan: null, recentScans: [],
  sessionCount: {},                    // "station||empId" -> scans this session (no cap)
  loading: true, connected: true, pending: 0, statusMsg: ''
};

(function () {
  try {
    var u = new URLSearchParams(window.location.search);
    state.hall = (u.get('hall') || '').trim();
  } catch (e) {}
})();

/** Same naam ke stations (jaise 2 Dispatched rows, dono Common) ka ek hi card/entry. Dono codes chalte rahenge. */
function uniqueStationNames(rows) {
  var seen = {}, out = [];
  rows.forEach(function (r) {
    var k = String(r.name).trim().toLowerCase();
    if (!seen[k]) { seen[k] = 1; out.push(r.name); }
  });
  return out;
}
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
  return call('init', { limit: 0, counts: 1 }).then(function (res) {
    applySettings(res.settings);
    state.sessionCount = res.todayCounts || {};
    var rows = res.stationRows || [];
    state.stationRows = rows.filter(function (r) { return inHall(r.hall); });
    state.stations = uniqueStationNames(state.stationRows);
    state.staff = (res.staff || []).filter(function (s) { return inHall(s.hall); });
    state.plan = res.plan || [];
    state.loading = false;
    render();
    startPolling();
    if (isCommonHall()) dspInit();
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
  call('init', { limit: 0, counts: 1 }).then(function (res) {
    applySettings(res.settings);
    state.sessionCount = res.todayCounts || {};
    var rows = res.stationRows || [];
    state.stationRows = rows.filter(function (r) { return inHall(r.hall); });
    state.stations = uniqueStationNames(state.stationRows);
    state.staff = (res.staff || []).filter(function (s) { return inHall(s.hall); });
    state.plan = res.plan || [];
    render();
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

function matchStation(raw) {
  var key = String(raw).trim().toLowerCase();
  var m = null;
  // Pehle CODE se match (scanner prefix), station ka NAME return karo.
  state.stationRows.forEach(function (r) {
    if (r.code && r.code.toLowerCase() === key) m = r.name;
  });
  // Transition ke liye: purana naam-prefix bhi chale.
  if (!m) state.stationRows.forEach(function (r) {
    if (r.name.toLowerCase() === key) m = r.name;
  });
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

  // Common (Dispatch) page: station prefix na ho to Dispatch station maano.
  // Badge ya LP serial nahi hai to wo Dispatch order ka barcode hai (dispatch.js).
  if (isCommonHall()) {
    station = station || commonStation();
    var badgeTry = /^STAFF:/i.test(rest) ? rest.replace(/^STAFF:/i, '').trim() : rest;
    if (!/^STAFF:/i.test(rest) && !matchStaff(badgeTry) && !isValidSerial(rest)) { dispatchScan(rest); return; }
  }

  if (!station) {
    flash('flash-error'); beep(false);
    setBanner('error', 'Scan pe station prefix nahi hai (scanner ka prefix check karo). Save NAHI hua.');
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
    setBanner('error', station + ' pe koi employee sign-in nahi hai - pehle employee ka badge scan karo. Save NAHI hua.');
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

/* ---------------- Serial check ---------------- */

/** Sirf asli battery serial ko pass karta hai (BMS QR / MAC / cell code ko nahi). Pattern config.js me. */
function isValidSerial(code) {
  if (!CONFIG.SERIAL_PATTERN) return true;
  try { return new RegExp(CONFIG.SERIAL_PATTERN, 'i').test(code); } catch (e) { return true; }
}

/* ---------------- Banner (alert() ki jagah) ---------------- */

function setBanner(kind, text) { state.banner = { kind: kind, text: text }; updateBanner(); }

function updateBanner() {
  var el = document.getElementById('bannerBox');
  if (!el) return;
  var html = '';
  if (state.banner) html += '<div class="banner ' + state.banner.kind + '">' + esc(state.banner.text) + '</div>';
  if (outbox.length) {
    var age = Math.round((Date.now() - outbox[0].ts) / 1000);
    if (age > 30) {
      html += '<div class="banner error">' + outbox.length + ' scan abhi Sheet me save nahi hue (sabse purana ' + age +
              ' sec). Scans is PC pe SAFE hain - net check karo, page band mat karo.' +
              (lastFlushErr ? ' [' + esc(lastFlushErr) + ']' : '') + '</div>';
    }
  }
  el.innerHTML = html;
}
setInterval(updateBanner, 3000);

/* ---------------- Outbox: durable queue + batch sync ---------------- */

var OUTBOX_KEY = 'plt_outbox_v1';
var outbox = [];            // [{id, packId, station, operatorId, operatorName, hall, floor, ts}]
var liveEntries = {};       // scanId -> screen pe dikhne wala entry
var inflight = false, flushTimer = null, lastFlushErr = '';

function outboxLoad() {
  try { outbox = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') || []; } catch (e) { outbox = []; }
}
function outboxSave() {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch (e) {}
}
function newScanId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function enqueue(job) {
  outbox.push(job);
  outboxSave();
  if (!flushTimer && !inflight) flushTimer = setTimeout(flush, CONFIG.BATCH_MS || 800);
}

function flush() {
  flushTimer = null;
  if (inflight || !outbox.length) return;
  var batch = outbox.slice(0, CONFIG.BATCH_MAX || 40);
  inflight = true;
  updateConn();

  var ctrl = window.AbortController ? new AbortController() : null;
  var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, CONFIG.BATCH_TIMEOUT_MS || 90000);

  fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // simple request: preflight nahi lagta
    body: JSON.stringify({ action: 'scanBatch', scans: batch }),
    signal: ctrl ? ctrl.signal : undefined
  }).then(function (r) { return r.json(); })
    .then(function (res) {
      clearTimeout(to);
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Server error');
      applyResults(batch, res.results || []);
      lastFlushErr = ''; state.connected = true;
    })
    .catch(function (err) {
      clearTimeout(to);
      lastFlushErr = (err && err.message) || 'Network error';
      state.connected = false;
    })
    .then(function () {
      inflight = false;
      updateConn(); render();
      if (outbox.length) flushTimer = setTimeout(flush, lastFlushErr ? (CONFIG.RETRY_MS || 5000) : 200);
    });
}

/** Server ke result ke hisaab se outbox saaf karta hai. Jis scan ka ack nahi aaya wo outbox me rehta hai. */
function applyResults(batch, results) {
  var byId = {};
  results.forEach(function (r) { byId[r.id] = r; });
  var done = {};
  batch.forEach(function (j) {
    var r = byId[j.id];
    if (!r || r.status === 'error') return;               // ack nahi -> agli baar phir jaayega
    done[j.id] = true;
    var e = liveEntries[j.id];
    if (r.status === 'rejected') {
      if (e) { e.rejected = true; e.msg = r.msg || 'Rejected'; }
      setBanner('error', j.packId + ': ' + (r.msg || 'Server ne reject kiya') + ' - Save NAHI hua.');
      beep(false);
    } else if (e) {
      e.synced = true;
    }
    delete liveEntries[j.id];
  });
  outbox = outbox.filter(function (j) { return !done[j.id]; });
  outboxSave();
}

function failedList() { return outbox; }       // retry bar + beforeunload isi se chalte hain
function retryFailed() { if (!flushTimer) flush(); }

/** Emergency: jo scan abhi tak Sheet me nahi gaye unki CSV. */
function downloadOutbox() {
  var rows = [['scanId', 'time', 'floor', 'hall', 'station', 'serial', 'empId', 'empName']];
  outbox.forEach(function (j) {
    rows.push([j.id, new Date(j.ts).toISOString(), j.floor, j.hall, j.station, j.packId, j.operatorId, j.operatorName]);
  });
  downloadCSV(rows, 'unsent-scans-' + Date.now() + '.csv');
}

function commitScan(code, station, emp) {
  code = String(code || '').trim();

  // 1) Serial hi hai na? BMS / cell ka code ho to log hi mat karo.
  if (!isValidSerial(code)) {
    flash('flash-error'); beep(false);
    setBanner('error', 'Ye battery serial nahi hai: "' + code.slice(0, 40) +
              '". BMS / cell ka sticker mat scan karo. Save NAHI hua.');
    return;
  }

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

  // Local pe turant log - operator ko network ka wait nahi.
  var ts = Date.now();
  var id = newScanId();
  if (!state.packs[code]) state.packs[code] = { id: code, currentStage: station, status: 'pending', history: [] };
  var entry = {
    id: id, station: station, operatorId: emp.id, operatorName: emp.name,
    timestamp: ts, result: 'pending', synced: false, failed: false, rejected: false
  };
  state.packs[code].history.push(entry);
  state.packs[code].currentStage = station;
  liveEntries[id] = entry;

  state.lastScan = { packId: code, entry: entry };
  state.recentScans.unshift({ packId: code, station: station, operator: emp.name, time: ts, entry: entry });
  state.recentScans = state.recentScans.slice(0, 30);

  var ck = station + '||' + emp.id.toLowerCase();
  state.sessionCount[ck] = (state.sessionCount[ck] || 0) + 1;

  state.banner = null;
  flash('flash'); beep(true); render();

  enqueue({
    id: id, packId: code, station: station,
    operatorId: emp.id, operatorName: emp.name,
    hall: state.hall, floor: CONFIG.FLOOR, ts: ts
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
    var sync = e.rejected ? '<span class="sync error">REJECTED</span>'
             : e.synced ? '<span class="sync saved">saved &#10003;</span>'
             : '<span class="sync saving">queued</span>';
    lastScanHtml =
      '<div class="last-scan">' +
        '<div><div class="id">' + esc(state.lastScan.packId) + '</div>' +
        '<div class="meta">' + esc(e.station) + ' &middot; ' + esc(e.operatorName) + ' &middot; ' + fmtTime(e.timestamp) + ' &middot; ' + sync + '</div></div>' +
      '</div>';
  }

  var rows = state.recentScans.map(function (r) {
    var mark = r.entry.rejected ? '<span class="sync error">REJECTED</span>'
             : r.entry.synced ? '<span class="sync saved">&#10003;</span>' : '<span class="sync saving">queued</span>';
    return '<tr><td class="mono">' + esc(r.packId) + ' ' + mark + '</td><td>' + esc(r.station) +
           '</td><td>' + esc(r.operator) + '</td><td class="mono">' + fmtTime(r.time) + '</td></tr>';
  }).join('');

  var failed = lastFlushErr ? outbox.length : 0;
  var retryBar = failed
    ? '<div style="margin-top:12px;"><button class="btn secondary" onclick="retryFailed()">Retry ' + failed + ' held scan(s)</button> ' +
      '<button class="btn secondary" onclick="downloadOutbox()">Unsent scans CSV</button></div>'
    : '';

  // Live board: one card per station in this hall, showing who is signed in
  // and how many batteries they have scanned this session.
  var sessionCount = state.sessionCount;
  var maxCount = 0;
  state.stations.forEach(function (st) {
    var e = state.stationEmp[st];
    if (!e) return;
    var c = sessionCount[st + '||' + e.id.toLowerCase()] || 0;
    if (c > maxCount) maxCount = c;
  });

  var boardCards = state.stations.map(function (st) {
    var emp = state.stationEmp[st];
    var count = emp ? (sessionCount[st + '||' + emp.id.toLowerCase()] || 0) : 0;
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

  // Today's production plan (from the ERP slip). Same on every hall.
  var plan = state.plan || [];
  var planTotal = plan.reduce(function (a, r) { return a + (r.planned || 0); }, 0);
  var planRows = plan.map(function (r) {
    return '<tr><td>' + esc(r.model || r.type || '-') + '</td>' +
           '<td class="mono">' + esc(r.order) + '</td>' +
           '<td class="mono">' + r.planned + '</td></tr>';
  }).join('');
  var planPanel = '<div class="panel"><div class="panel-title">Today\'s production plan &middot; ' + planTotal + ' planned</div>' +
    (plan.length
      ? '<div class="table-wrap"><table><thead><tr><th>Model</th><th>Order</th><th>Planned</th></tr></thead><tbody>' + planRows + '</tbody></table></div>'
      : '<div class="empty">No plan for today yet.</div>') +
    '</div>';

  return '<div id="bannerBox"></div>' +
    '<div class="panel scan-panel">' +
      '<div class="scan-box" id="scanBox">' +
        '<input id="universalScan" type="text" placeholder="Scan badge or battery" autocomplete="off" ' +
        'onkeydown="if(event.key===\'Enter\'){handleUniversalScan(this.value); this.value=\'\';}">' +
        '<div class="scan-hint">' + esc(hint) + '</div>' +
        '<div class="scan-readout">' + (state.lastScan ? 'Last battery: ' + esc(state.lastScan.packId) : 'No scans yet') + '</div>' +
      '</div>' +
      lastScanHtml + retryBar +
    '</div>' +
    (isCommonHall() ? renderDispatchPanel() : '') +
    planPanel +
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
  updateBanner();
  var input = document.getElementById('universalScan');
  if (input) input.focus();
}

/* ---------------- Boot ---------------- */

outboxLoad();                       // pichhle session ke unsent scans wapas
render();
loadAll();
if (outbox.length) flush();

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
