/* Pack Line Tracker - configuration
   Edit this file only; app.js does not need changes. */

var CONFIG = {

  // Apps Script Web App /exec URL (Deploy > New deployment > Web app)
  API_URL: 'https://script.google.com/macros/s/AKfycbxq7TdhXbdXWTPP8aDiYuGVt74Fu04i4v4rC9mvborXjeMO9mDEuBOWapKle2LSc0XjLg/exec',

  // Which floor/unit this PC belongs to. Goes into every log row so all
  // floors can share one Sheet but each PC only sees its own work.
  FLOOR: 'Floor-1',

  // Dashboard auto-refresh interval (ms). 0 disables polling.
  POLL_MS: 15000,

  // How many recent log rows to pull on load. Higher = slower first load.
  LOG_LIMIT: 3000,

  // Warn if a pack is scanned out of station order (operator can override).
  ENFORCE_SEQUENCE: false,

  // JSONP request timeout (ms).
  TIMEOUT_MS: 20000
};
