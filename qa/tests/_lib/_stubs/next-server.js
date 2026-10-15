// next/server with after() run straight away (there is no request to outlive here).
const real = require(require.resolve("next/server", { paths: [process.cwd()] }));
module.exports = { ...real, after: (fn) => { Promise.resolve().then(() => (typeof fn === "function" ? fn() : fn)).catch(() => {}); } };
