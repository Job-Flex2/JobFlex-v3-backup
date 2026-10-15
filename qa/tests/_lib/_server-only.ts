// `server-only` outside Next — the one stub the data-level checks share.
//
// Next resolves `import "server-only"` (lib/sdk/stripe, lib/crypto/secretBox,
// lib/oauthState …) to its own bundled marker: an empty module under the
// `react-server` condition, a module that throws in a client bundle. Plain
// node has neither — the package is not a dependency, and the npm one throws
// as well — so a check that reaches any of those modules through tsx died on
// "Cannot find module 'server-only'" (since 996a45c, 2026-09-23).
//
// This makes the bare specifier resolve to an empty module, exactly what Next
// gives the server. Import it FIRST in a check — before anything that reaches
// the app's lib — because a require chain runs in order and the patch must be
// in place when the marker is asked for:
//
//   import "./_server-only";
//
// Only checks touch it; the app never loads this file.
import Module from "node:module";

type Loader = {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
  _cache: Record<string, unknown>;
};

const M = Module as unknown as Loader;
const STUB = "server-only";

if (!M._cache[STUB]) {
  const resolve = M._resolveFilename;
  M._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
    return request === STUB ? STUB : resolve.call(this, request, ...rest);
  };
  M._cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: {} };
}
