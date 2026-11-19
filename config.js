/* Pack Line Tracker - configuration
   Edit this file only; app.js does not need changes. */

var CONFIG = {

  // Apps Script Web App /exec URL (Deploy > New deployment > Web app)
  API_URL: 'https://script.google.com/macros/s/AKfycbwEIARuY-ZvIcg5PFsavfljDVNIfOuI2KFB-xrvC02FIrR-4XCPBmJZokVZFQCx0_WplA/exec',

  // Which floor/unit this PC belongs to. Goes into every log row so all
  // floors can share one Sheet but each PC only sees its own work.
  FLOOR: 'Floor-1',

  // Dashboard auto-refresh interval (ms). 0 disables polling.
  POLL_MS: 15000,

  // How many recent log rows to pull on load. Higher = slower first load.
  LOG_LIMIT: 3000,

  // Warn if a pack is scanned out of station order (operator can override).
  ENFORCE_SEQUENCE: false,

  // Labels page: kis hall mein Master Sheet ki kaunsi Category ke models bante hain
  HALL_CATEGORIES: {
    '2 Wheeler': ['2 Wheeler'],
    'E-Cycle':   ['E-Cycle'],
    'Prismatic': ['3 Wheeler', 'Inverter', 'Solar']
  },

  // Valid battery serial (regex). LP6036-0034 aur LP-6040-00001 dono chalenge.
  // BMS QR / MAC / cell code reject honge. Khaali '' rakho to check band.
  // NOTE: Apps Script ke SERIAL_RE se same rakhna.
   SERIAL_PATTERN: '^LP-?[A-Z0-9]+-\\d{3,6}$',

  // Scan sync: pehla scan itne ms baad batch me jaata hai; ek batch me max itne scan;
  // fail hone par itne ms baad retry.
  BATCH_MS: 800,
  BATCH_MAX: 20,
  BATCH_TIMEOUT_MS: 90000,   // batch call ka timeout (server ek scan me ~1-2s leta hai)
  RETRY_MS: 5000,

  // JSONP request timeout (ms).
  TIMEOUT_MS: 45000
};
