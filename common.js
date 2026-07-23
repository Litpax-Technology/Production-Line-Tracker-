/* Shared helpers - loaded by both index.html and admin.html */

var state = {};              // each page fills its own shape
var jsonpSeq = 0;

/* ---------------- JSONP transport ---------------- */

function jsonp(params) {
  return new Promise(function (resolve, reject) {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
      reject(new Error('API_URL is not set in config.js'));
      return;
    }
    var cb = '__plt_cb_' + Date.now() + '_' + (jsonpSeq++);
    var script = document.createElement('script');
    var done = false;

    var timer = setTimeout(function () { cleanup(); reject(new Error('Request timed out')); },
                           CONFIG.TIMEOUT_MS || 20000);

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
  state.pending = (state.pending || 0) + 1;
  updateConn();
  return jsonp(p).then(function (res) {
    state.pending--; state.connected = true; updateConn();
    return res;
  }, function (err) {
    state.pending--; updateConn();
    throw err;
  });
}

/* ---------------- Formatting ---------------- */

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
    txt.textContent = 'Not connected - scans are held on this device';
  } else if (state.pending > 0) {
    dot.className = 'conn-dot busy';
    txt.textContent = 'Saving to Sheet... (' + state.pending + ')';
  } else {
    dot.className = 'conn-dot';
    txt.textContent = 'Connected - ' + (CONFIG.FLOOR || 'no floor set');
  }
}

/** Rebuilds pack objects from raw log rows: [ts,floor,packId,station,opId,opName,result] */
function buildPacks(logs) {
  var packs = {};
  logs.slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (r) {
    var id = r[2];
    if (!packs[id]) packs[id] = { id: id, currentStage: r[3], status: 'pending', history: [] };
    packs[id].history.push({
      station: r[3], operatorId: r[4], operatorName: r[5],
      timestamp: r[0], result: r[6] || 'pending', synced: true
    });
    packs[id].currentStage = r[3];
    packs[id].status = r[6] || 'pending';
  });
  return packs;
}

function downloadCSV(rows, filename) {
  var csv = rows.map(function (r) {
    return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
