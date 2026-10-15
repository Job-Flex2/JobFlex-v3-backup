// QA stand-in for the `twilio` package (qa/tests/_lib/_no-sms.js loads it for every old script
// the QA Lab runs). Any call through the client — messages.create, verify…verifications.create,
// services.list — is recorded and answered locally; nothing reaches Twilio, whatever keys the
// environment holds. `list` answers []; `create` / `update` / `fetch` answer a fake record.
const sent = (globalThis.__qaTwilio ??= []);
let n = 0;

function node(path) {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === "then") return undefined; // not a promise
      if (prop === "__qaPath") return path;
      return node([...path, String(prop)]);
    },
    apply(_t, _this, args) {
      const last = path[path.length - 1];
      if (last === "list" || last === "page" || last === "each") return Promise.resolve([]);
      if (["create", "update", "fetch", "remove"].includes(last)) {
        const call = { path: path.join("."), args: JSON.parse(JSON.stringify(args ?? [])), at: Date.now() };
        sent.push(call);
        process.stderr.write(`[qa] twilio stub: ${call.path}${args?.[0]?.to ? ` to …${String(args[0].to).slice(-4)}` : ""}\n`);
        return Promise.resolve({ sid: `QA${String(++n).padStart(30, "0")}`, status: "queued", ...(args?.[0] ?? {}) });
      }
      return node(path); // services(sid), calls(sid)… — keep walking
    },
  });
}

function twilio() {
  return node(["client"]);
}
twilio.validateRequest = () => true;
twilio.validateRequestWithBody = () => true;
twilio.twiml = node(["twiml"]);
twilio.default = twilio;
module.exports = twilio;
