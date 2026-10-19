// The stand's guard against a billed EagleView order: a local proxy in front of the Property Data host
// (serve.cjs points EAGLEVIEW_PROPERTY_API_BASE_URL here). Reads (a stored order's result, its images)
// pass through; POST /property/v2/request — a new lookup, which EagleView bills — is refused with 403
// and logged, so no take can buy one. Log: $STAND/ev-guard.log.
const http = require("http"), https = require("https"), fs = require("fs"), path = require("path");
const PORT = +(process.env.EV_GUARD_PORT || 3512);
const LOG = path.join("C:/Projects/JobFlex-v3-copy", process.env.STAND || ".cache/roof-rec", "ev-guard.log");
const log = (s) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`);
http.createServer((req, res) => {
  if (req.method === "POST" && /\/property\/v2\/request/.test(req.url)) {
    log(`BLOCKED ${req.method} ${req.url} (a new order is billed)`);
    res.writeHead(403, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errorCode: 0, errorDescription: "film stand: new orders are blocked" }));
  }
  log(`pass ${req.method} ${req.url.replace(/image\/[^?]+/, "image/<token>")}`);
  const up = https.request({ host: "apis.eagleview.com", path: req.url, method: req.method, headers: { ...req.headers, host: "apis.eagleview.com" } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on("error", (e) => { log(`error ${e.message}`); res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(PORT, "127.0.0.1", () => log(`guard on :${PORT}`));
