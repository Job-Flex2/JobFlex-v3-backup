/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload, like the rest of _lib */
// Preloaded into every old script the QA Lab runs (legacy-run.js → NODE_OPTIONS --require):
// the `twilio` package — by require() or by import() — is replaced with the recording stand-in
// in _stubs/twilio-client.js. The Twilio keys stay as they are; no text or call can leave.
const path = require("path");
const { pathToFileURL } = require("url");
const mod = require("module");

const STUB = path.join(__dirname, "_stubs", "twilio-client.js");
if (typeof mod.registerHooks === "function") {
  mod.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "twilio") return { url: pathToFileURL(STUB).href, format: "commonjs", shortCircuit: true };
      return next(specifier, context);
    },
  });
} else {
  const resolve = mod._resolveFilename;
  mod._resolveFilename = function (request, ...rest) {
    if (request === "twilio") return STUB;
    return resolve.call(this, request, ...rest);
  };
}
