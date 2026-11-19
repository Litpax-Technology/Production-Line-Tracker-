/* Dispatch - sirf Common hall ke scan page par (?hall=Common).
   Order + Model chuno, barcode scan karo. Data Dispatch sheet (Today_Orders / Dispatch_Log) me jaata hai.
   Us sheet ya uske script me koi badlav nahi: PLT ka Apps Script use openById se padhta / likhta hai.
   Scan pehle is PC ke localStorage me jaata hai, phir batch me; ack aane par hi hat-ta hai. */

var DSP_KEY = 'plt_dsp_outbox_v1';
var dsp = { orders: [], order: '', model: '', msg: null, recent: [], err: '', started: false };
var dspQueue = [];          // [{id, code, order, model, ts, tried}]  - jinka ack nahi aaya
var dspInflight = false, dspTimer = null;
var dspSeen = {};           // is session ke barcodes

function isCommonHall() { return String((state && state.hall) || '').trim().toLowerCase() === 'common'; }

/** Common page par station prefix na ho to is hall ka ek hi station (Dispatched) maan lo. */
function commonStation() { return (state.stations && state.stations.length === 1) ? state.stations[0] : ''; }

function dspKey(o, m) { return o + ' / ' + m; }
function dspSave() { try { localStorage.setItem(DSP_KEY, JSON.stringify(dspQueue)); } catch (e) {} }
function dspLoadQueue() {
  try { dspQueue = JSON.parse(localStorage.getItem(DSP_KEY) || '[]') || []; } catch (e) { dspQueue = []; }
  dspQueue.forEach(function (j) { dspSeen[j.code] = 1; });
}

/* ---------------- Orders ---------------- */

function dspInit() {
  if (dsp.started) return;
  dsp.started = true;
  dspLoadQueue();
  dspLoad();
  if (dspQueue.length) dspFlush();
  setInterval(function () { if (!dspQueue.length && !dspInflight) dspLoad(); }, 60000);
  window.addEventListener('beforeunload', function (e) {
    if (dspQueue.length) { e.preventDefault(); e.returnValue = ''; }
  });
}

function dspLoad() {
  return call('dispatchOrders', {}).then(function (res) {
    dsp.orders = res.orders || [];
    dsp.err = '';
    render();
  }, function (err) {
    dsp.err = err.message;
    render();
  });
}

function dspItem(order, model) {
  var out = null;
  dsp.orders.forEach(function (o) {
    if (o.order === order) o.items.forEach(function (i) { if (i.model === model) out = i; });
  });
  return out;
}
function dspCurrent() { return dspItem(dsp.order, dsp.model); }
function dspPendingItems(order) {
  var out = [];
  dsp.orders.forEach(function (o) {
    if (o.order === order) o.items.forEach(function (i) { if (i.scanned < i.qty) out.push(i); });
  });
  return out;
}
function dspPendingCount(k) {
  return dspQueue.filter(function (j) { return dspKey(j.order, j.model) === k; }).length;
}

function dspSetOrder(v) { dsp.order = v; dsp.model = ''; dsp.msg = null; render(); }
function dspSetModel(v) { dsp.model = v; dsp.msg = null; render(); }

/* ---------------- Scan ---------------- */

function dspMark(id, status, note) {
  dsp.recent.forEach(function (r) { if (r.id === id) { r.status = status; r.note = note || ''; } });
}
function dspAddRecent(id, code, model, status, note) {
  dsp.recent.unshift({ id: id, code: code, model: model, status: status, note: note || '' });
  dsp.recent = dsp.recent.slice(0, 30);
}

function dspReject(code, reason) {
  dspAddRecent('r' + Date.now(), code, '', 'err', reason);
  dsp.msg = { kind: 'error', text: code + ' - ' + reason };
  beep(false);
  render();
}

/** Common page par LP serial / badge nahi hai to ye Dispatch ka barcode hai. */
function dispatchScan(code) {
  code = String(code || '').trim();
  if (!code) return;
  var it = dspCurrent();
  if (!it) return dspReject(code, 'Pehle Order + Model select karo');
  if (dspSeen[code]) return dspReject(code, 'Duplicate - abhi scan ho chuka');
  var k = dspKey(dsp.order, dsp.model);
  if (it.scanned + dspPendingCount(k) >= it.qty) return dspReject(code, 'Qty full (' + it.qty + ')');

  dspSeen[code] = 1;
  var id = newScanId();
  dspQueue.push({ id: id, code: code, order: dsp.order, model: dsp.model, ts: Date.now(), tried: false });
  dspSave();
  dspAddRecent(id, code, dsp.model, 'wait', '');
  dsp.msg = null;
  beep(true);
  render();
  if (!dspTimer && !dspInflight) dspTimer = setTimeout(dspFlush, CONFIG.BATCH_MS || 800);
}

function dspFlush() {
  dspTimer = null;
  if (dspInflight || !dspQueue.length) return;
  var batch = dspQueue.slice(0, 20);
  var items = batch.map(function (j) {
    return { id: j.id, order: j.order, model: j.model, code: j.code, retry: !!j.tried, ts: j.ts };
  });
  batch.forEach(function (j) { j.tried = true; });     // ab ye bheja ja chuka - dobara jaaye to server idempotent rakhega
  dspSave();
  dspInflight = true;

  var ctrl = window.AbortController ? new AbortController() : null;
  var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, CONFIG.BATCH_TIMEOUT_MS || 90000);

  fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'dispatchBatch', items: items }),
    signal: ctrl ? ctrl.signal : undefined
  }).then(function (r) { return r.json(); })
    .then(function (res) {
      clearTimeout(to);
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Server error');
      dspApply(batch, res);
      dsp.err = '';
    })
    .catch(function (err) {
      clearTimeout(to);
      dsp.err = (err && err.message) || 'Network error';
    })
    .then(function () {
      dspInflight = false;
      render();
      if (dspQueue.length) dspTimer = setTimeout(dspFlush, dsp.err ? (CONFIG.RETRY_MS || 5000) : 200);
    });
}

function dspApply(batch, res) {
  var byId = {}, done = {}, anyErr = false, lastOk = '';
  (res.results || []).forEach(function (r) { byId[r.id] = r; });

  batch.forEach(function (j) {
    var r = byId[j.id];
    if (!r) return;                                   // ack nahi -> queue me rehta hai
    done[j.id] = true;
    if (r.ok) { dspMark(j.id, 'ok', ''); lastOk = j.code; }
    else {
      anyErr = true;
      dspMark(j.id, 'err', r.reason);
      if (!/^Duplicate/.test(r.reason || '')) delete dspSeen[j.code];
      dsp.msg = { kind: 'error', text: j.code + ' - ' + (r.reason || 'Save nahi hua') };
      beep(false);
    }
  });
  dspQueue = dspQueue.filter(function (j) { return !done[j.id]; });
  dspSave();

  // Server ke asli counts
  var c = res.counts || {};
  dsp.orders.forEach(function (o) {
    o.items.forEach(function (i) { var x = c[dspKey(o.order, i.model)]; if (x) i.scanned = x.scanned; });
  });

  var it = dspCurrent();
  if (it && it.scanned >= it.qty && !dspPendingCount(dspKey(dsp.order, dsp.model))) {
    dspAdvance();
  } else if (lastOk && !anyErr && it) {
    dsp.msg = { kind: 'ok', text: lastOk + '  ->  ' + it.scanned + ' / ' + it.qty };
  }
}

function dspAdvance() {
  var finished = dsp.model, order = dsp.order;
  beep(true); setTimeout(function () { beep(true); }, 140);
  var rest = dspPendingItems(order);
  if (rest.length) {
    dsp.model = rest[0].model;
    dsp.msg = { kind: 'ok', text: finished + ' complete - ab ' + dsp.model + ' scan karo' };
  } else {
    dsp.order = ''; dsp.model = '';
    dsp.msg = { kind: 'ok', text: 'Order ' + order + ' COMPLETE - agla order select karo' };
  }
}

/* ---------------- Render ---------------- */

function renderDispatchPanel() {
  var orders = dsp.orders.filter(function (o) { return o.items.some(function (i) { return i.scanned < i.qty; }); });
  if (dsp.order && !orders.some(function (o) { return o.order === dsp.order; })) { dsp.order = ''; dsp.model = ''; }
  var items = dspPendingItems(dsp.order);
  if (dsp.model && !items.some(function (i) { return i.model === dsp.model; })) dsp.model = '';
  if (!dsp.model && items.length === 1) dsp.model = items[0].model;

  var optO = '<option value="">- Order select -</option>' + orders.map(function (o) {
    return '<option value="' + esc(o.order) + '"' + (o.order === dsp.order ? ' selected' : '') + '>' + esc(o.order) + '</option>';
  }).join('');
  var optM = '<option value="">- Model select -</option>' + items.map(function (i) {
    return '<option value="' + esc(i.model) + '"' + (i.model === dsp.model ? ' selected' : '') + '>' +
           esc(i.model) + ' (' + i.scanned + '/' + i.qty + ')</option>';
  }).join('');

  var it = dspCurrent();
  var n = it ? it.scanned + dspPendingCount(dspKey(dsp.order, dsp.model)) : 0;
  var pct = it && it.qty ? Math.min(100, Math.round(n / it.qty * 100)) : 0;

  var msg = dsp.msg ? '<div class="banner ' + dsp.msg.kind + '">' + esc(dsp.msg.text) + '</div>' : '';
  var stuck = (dspQueue.length && dsp.err)
    ? '<div class="banner error">' + dspQueue.length + ' dispatch scan abhi save nahi hue - scans is PC pe SAFE hain, net check karo. [' + esc(dsp.err) + ']</div>' : '';
  var loadErr = (!dsp.orders.length && dsp.err && !dspQueue.length)
    ? '<div class="banner error">Dispatch orders nahi aaye: ' + esc(dsp.err) + '</div>' : '';

  var rows = dsp.recent.slice(0, 15).map(function (r) {
    var mark = r.status === 'ok' ? '<span class="sync saved">&#10003;</span>'
             : r.status === 'err' ? '<span class="sync error">' + esc(r.note || 'error') + '</span>'
             : '<span class="sync saving">queued</span>';
    return '<tr><td class="mono">' + esc(r.code) + '</td><td>' + esc(r.model) + '</td><td>' + mark + '</td></tr>';
  }).join('');

  return '<div class="panel dsp-panel"><div class="panel-title">Dispatch &middot; Order scan</div>' +
    '<div class="row">' +
      '<div class="field"><label>Order ID</label><select onchange="dspSetOrder(this.value)">' + optO + '</select></div>' +
      '<div class="field"><label>Model</label><select onchange="dspSetModel(this.value)">' + optM + '</select></div>' +
    '</div>' +
    '<div class="dsp-counter">' + (it ? n + ' / ' + it.qty : '- / -') + '</div>' +
    '<div class="dsp-track"><div class="dsp-bar" style="width:' + pct + '%"></div></div>' +
    '<div class="scan-hint">Wahi scan box: LP serial / badge PLT me jaata hai, baaki barcode Dispatch sheet me.</div>' +
    msg + stuck + loadErr +
    (rows ? '<div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>Barcode</th><th>Model</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
    '<div style="margin-top:10px;"><button class="btn secondary" onclick="dspLoad()">Refresh orders</button></div>' +
  '</div>';
}
