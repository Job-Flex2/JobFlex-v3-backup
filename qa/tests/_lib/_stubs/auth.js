// Stand-in for src/lib/auth: the session is whatever the check put in globalThis.__auditSession.
exports.auth = async () => globalThis.__auditSession ?? null;
exports.signIn = async () => { throw new Error("signIn not available in the check"); };
exports.signOut = async () => {};
exports.handlers = {};
