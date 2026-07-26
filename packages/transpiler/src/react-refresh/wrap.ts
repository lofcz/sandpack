// The react-refresh half of the per-file chain. Moved verbatim from
// sandbox/src/bundler/transforms/react-refresh/index.ts (the Bundler/fs wiring —
// writing HELPER_CODE to the in-memory fs and registering the runtime — left
// behind in sandbox). This module is pure: it wraps already-Babel'd code with
// the HMR boundary prelude/postlude and names the helper dependency. Consumers
// are responsible for materialising HELPER_CODE at HELPER_PATH.
//
// Every byte here is part of the artifact: the wrapper is concatenated around
// the Babel output, so any edit changes the emitted bytes and MUST bump the
// package version (§4.4).

export const HELPER_PATH = '/node_modules/__csb_bust/refresh-helper.js';

export const HELPER_CODE = `
const Refresh = require('react-refresh/runtime');

function debounce(func, wait, immediate) {
	var timeout;
	return function() {
		var context = this, args = arguments;
		var later = function() {
			timeout = null;
			if (!immediate) func.apply(context, args);
		};
		var callNow = immediate && !timeout;
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
		if (callNow) func.apply(context, args);
	};
};

// Surface a failed refresh to the host instead of rethrowing it on the
// setTimeout stack: a timer-fired throw lands on a barren async boundary with
// no module context, so the bundler's error listener can't map it and the
// preview just unmounts to white. Decline the update (the dirty module's
// initiators reload on the next edit) and report the real error object so the
// bundler can draw its overlay with a source-mapped stack.
const enqueueUpdate = debounce(() => {
  try {
    Refresh.performReactRefresh();
  } catch (e) {
    try {
      module.hot.decline();
      window.dispatchEvent(new CustomEvent('sandpack:refresh-error', { detail: { error: e } }));
    } catch (reportErr) {
      // Reporting must never throw on the timer stack — fall back to the
      // uncaught path only if dispatch itself blew up.
      setTimeout(function () { throw e; });
    }
  }
}, 30);

function isReactRefreshBoundary(moduleExports) {
  if (Object.keys(Refresh).length === 0) {
    return false;
  }

  if (Refresh.isLikelyComponentType(moduleExports)) {
    return true;
  }
  if (moduleExports == null || typeof moduleExports !== 'object') {
    // Exit if we can't iterate over exports.
    return false;
  }
  let hasExports = false;
  let areAllExportsComponents = true;
  for (const key in moduleExports) {
    hasExports = true;
    if (key === '__esModule') {
      continue;
    }
    const desc = Object.getOwnPropertyDescriptor(moduleExports, key);
    if (desc && desc.get) {
      // Don't invoke getters as they may have side effects.
      return false;
    }
    const exportValue = moduleExports[key];
    if (!Refresh.isLikelyComponentType(exportValue)) {
      areAllExportsComponents = false;
    }
  }
  return hasExports && areAllExportsComponents;
};

// When this signature changes, it's unsafe to stop at this refresh boundary.
function getRefreshBoundarySignature(moduleExports) {
  const signature = [];
  signature.push(Refresh.getFamilyByType(moduleExports));
  if (moduleExports == null || typeof moduleExports !== 'object') {
    // Exit if we can't iterate over exports.
    // (This is important for legacy environments.)
    return signature;
  }
  for (const key in moduleExports) {
    if (key === '__esModule') {
      continue;
    }
    const desc = Object.getOwnPropertyDescriptor(moduleExports, key);
    if (desc && desc.get) {
      continue;
    }
    const exportValue = moduleExports[key];
    signature.push(key);
    signature.push(Refresh.getFamilyByType(exportValue));
  }
  return signature;
};

function shouldInvalidateReactRefreshBoundary(
  prevExports,
  nextExports,
) {
  const prevSignature = getRefreshBoundarySignature(prevExports);
  const nextSignature = getRefreshBoundarySignature(nextExports);
  if (prevSignature.length !== nextSignature.length) {
    return true;
  }
  for (let i = 0; i < nextSignature.length; i++) {
    if (prevSignature[i] !== nextSignature[i]) {
      return true;
    }
  }
  return false;
};

var registerExportsForReactRefresh = (moduleExports, moduleID) => {
  Refresh.register(moduleExports, moduleID + ' %exports%');
  if (moduleExports == null || typeof moduleExports !== 'object') {
    // Exit if we can't iterate over exports.
    // (This is important for legacy environments.)
    return;
  }
  for (const key in moduleExports) {
    const desc = Object.getOwnPropertyDescriptor(moduleExports, key);
    if (desc && desc.get) {
      // Don't invoke getters as they may have side effects.
      continue;
    }
    const exportValue = moduleExports[key];
    const typeID = moduleID + ' %exports% ' + key;
    Refresh.register(exportValue, typeID);
  }
};

function prelude(module) {
  window.$RefreshReg$ = (type, id) => {
    // Note module.id is webpack-specific, this may vary in other bundlers
    const fullId = module.id + ' ' + id;
    Refresh.register(type, fullId);
  }

  window.$RefreshSig$ = Refresh.createSignatureFunctionForTransform;
}

function postlude(module) {
  const isHotUpdate = !!module.hot.data;
  const prevExports = isHotUpdate ? module.hot.data.prevExports : null;
  if (isReactRefreshBoundary) {
    if (isReactRefreshBoundary(module.exports)) {
      registerExportsForReactRefresh(module.exports, module.id);
      const currentExports = { ...module.exports };

      module.hot.dispose(function hotDisposeCallback(data) {
        data.prevExports = currentExports;
      });

      if (isHotUpdate && shouldInvalidateReactRefreshBoundary(prevExports, currentExports)) {
        module.hot.invalidate();
      } else {
        module.hot.accept();
      }

      enqueueUpdate();
    } else if (isHotUpdate && isReactRefreshBoundary(prevExports)) {
      module.hot.invalidate();
    }
  }
}

module.exports = {
  enqueueUpdate,
  isReactRefreshBoundary,
  registerExportsForReactRefresh,
  shouldInvalidateReactRefreshBoundary,
  prelude,
  postlude,
};
`.trim();

const prelude = `var _csbRefreshUtils = require("${HELPER_PATH}");
var prevRefreshReg = window.$RefreshReg$;
var prevRefreshSig = window.$RefreshSig$;
_csbRefreshUtils.prelude(module);
`.replace(/[\n]+/gm, '');

const postlude = `
_csbRefreshUtils.postlude(module);
window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;`;

// Lines the collapsed `prelude` occupies above the Babel output. The Babel
// inline source map counts lines from the start of ITS output; the wrapper
// shifts every emitted line down by this many rows. We adjust the map's
// `mappings` by prepending that many empty generated lines (";") so original
// positions still resolve after the shift.
const PRELUDE_LINE_COUNT = 3;

// Portable base64 — `Buffer` in Node (tests/CLI), `atob`/`btoa` in the worker.
// `Buffer` is referenced only behind a typeof guard, so it's never touched in
// the browser; the ambient declare keeps the DTS build from needing @types/node.
declare const Buffer: any;
function b64decode(b64: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
  return decodeURIComponent(
    Array.prototype.map
      .call(atob(b64), (c: string) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  );
}
function b64encode(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  return btoa(
    Array.prototype.map
      .call(unescape(encodeURIComponent(text)), (c: string) => String.fromCharCode(c.charCodeAt(0)))
      .join('')
  );
}

/**
 * Shift an inline-source-mapped module down by `lines` generated lines.
 *
 * A source map's `mappings` is a `;`-separated list of generated lines, so
 * prepending `lines` ";" inserts that many empty lines at the top — exactly
 * the offset the react-refresh prelude adds. This is a pure string op on the
 * trailing `//# sourceMappingURL=data:...;base64,<map>` comment; if the code
 * carries no inline map (e.g. a no-op module), it's returned untouched.
 */
function shiftInlineSourceMap(code: string, lines: number): string {
  if (lines <= 0) return code;
  const marker = '//# sourceMappingURL=data:application/json;';
  const idx = code.lastIndexOf(marker);
  if (idx === -1) return code;
  const base64Sep = code.indexOf('base64,', idx);
  if (base64Sep === -1) return code;
  const dataStart = base64Sep + 'base64,'.length;
  // The map payload runs to end-of-line (it's always the last comment).
  const head = code.slice(0, dataStart);
  const payload = code.slice(dataStart).replace(/[\r\n]+$/g, '');
  try {
    const map = JSON.parse(b64decode(payload));
    map.mappings = ';'.repeat(lines) + (map.mappings || '');
    return head + b64encode(JSON.stringify(map));
  } catch {
    // A malformed map must never break the transform — ship the code as-is.
    return code;
  }
}

/**
 * The runtime injected once (per bundler) to bootstrap react-refresh. Sandbox
 * registers this as the react-refresh-transformer's runtime; the CLI does not
 * need it for artifact emission but it is exported for parity/completeness.
 */
export const REACT_REFRESH_RUNTIME = `
if (typeof window !== 'undefined') {
  const runtime = require('react-refresh/runtime');
  runtime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => type => type;
}
`;

/**
 * Wrap Babel-transformed source in the HMR boundary prelude/postlude.
 *
 * Invariants this wrapper must keep (both were broken by the naive
 * one-line `prelude + code + postlude` wrap):
 *
 *  - The Babel output's trailing `//# sourceMappingURL` comment stays LAST.
 *    The sandbox appends `//# sourceURL=<file>` when evaluating, and a module
 *    only has one effective map + one effective sourceURL — both must sit at
 *    the very end, sourceURL last, or devtools / the error mapper never apply
 *    the map. So the postlude goes BEFORE the map comment, not after it.
 *  - The module body is NOT wrapped in `try {}`. Babel lowers ESM `import`s to
 *    top-of-body `require` + interop declarations; putting those inside a
 *    `try` block scopes them so a re-run (HMR re-eval) re-executes against a
 *    fresh function scope and surfaces `ReferenceError: <ident> is not
 *    defined` with no mappable frame. Restoring `$RefreshReg$`/`$RefreshSig$`
 *    by simple assignment (not `finally`) keeps the body at top level.
 *
 * The prelude is collapsed to its own lines and the map is shifted to match,
 * so original positions survive the wrap.
 */
export const getWrapperCode = (sourceCode: string): string => {
  const marker = '\n//# sourceMappingURL=';
  const idx = sourceCode.lastIndexOf(marker);
  if (idx === -1) {
    // No inline map (no-op module) — nothing to preserve; plain concat.
    return prelude + sourceCode + '\n' + postlude;
  }
  const body = sourceCode.slice(0, idx);
  const mapComment = sourceCode.slice(idx); // includes the leading "\n"
  const shifted = prelude + body + '\n' + postlude + mapComment;
  return shiftInlineSourceMap(shifted, PRELUDE_LINE_COUNT);
};
