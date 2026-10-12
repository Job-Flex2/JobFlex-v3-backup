// Stand-in for next/headers outside a request: an empty cookie jar and the headers the check sets.
const jar = new Map();
const store = {
  get: (n) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined),
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  has: (n) => jar.has(n),
  set: (n, v) => { jar.set(typeof n === "object" ? n.name : n, typeof n === "object" ? n.value : v); },
  delete: (n) => { jar.delete(n); },
};
exports.cookies = async () => store;
exports.headers = async () => new Headers(globalThis.__auditHeaders || {});
exports.draftMode = async () => ({ isEnabled: false });
exports.__jar = jar;
