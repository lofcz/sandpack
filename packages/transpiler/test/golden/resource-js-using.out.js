var _csbRefreshUtils = require("/node_modules/__csb_bust/refresh-helper.js");var prevRefreshReg = window.$RefreshReg$;var prevRefreshSig = window.$RefreshSig$;_csbRefreshUtils.prelude(module);"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.readAll = readAll;
require("core-js/modules/esnext.symbol.async-dispose.js");
require("core-js/modules/esnext.symbol.dispose.js");
function _usingCtx2() { var r = "function" == typeof SuppressedError ? SuppressedError : function (r, e) { var n = Error(); return n.name = "SuppressedError", n.error = r, n.suppressed = e, n; }, e = {}, n = []; function using(r, e) { if (null != e) { if (Object(e) !== e) throw new TypeError("using declarations can only be used with objects, functions, null, or undefined."); if (r) var o = e[Symbol.asyncDispose || Symbol.for("Symbol.asyncDispose")]; if (void 0 === o && (o = e[Symbol.dispose || Symbol.for("Symbol.dispose")], r)) var t = o; if ("function" != typeof o) throw new TypeError("Object is not disposable."); t && (o = function () { try { t.call(e); } catch (r) { return Promise.reject(r); } }), n.push({ v: e, d: o, a: r }); } else r && n.push({ d: e, a: r }); return e; } return { e: e, u: using.bind(null, !1), a: using.bind(null, !0), d: function () { var o, t = this.e, s = 0; function next() { for (; o = n.pop();) try { if (!o.a && 1 === s) return s = 0, n.push(o), Promise.resolve().then(next); if (o.d) { var r = o.d.call(o.v); if (o.a) return s |= 2, Promise.resolve(r).then(next, err); } else s |= 1; } catch (r) { return err(r); } if (1 === s) return t !== e ? Promise.reject(t) : Promise.resolve(); if (t !== e) throw t; } function err(n) { return t = t !== e ? new r(n, t) : n, next(); } return next(); } }; }
function readAll(open) {
  try {
    var _usingCtx = _usingCtx2();
    const handle = _usingCtx.u(open());
    return handle.readToEnd();
  } catch (_) {
    _usingCtx.e = _;
  } finally {
    _usingCtx.d();
  }
}

_csbRefreshUtils.postlude(module);
window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJyZWFkQWxsIiwib3BlbiIsIl91c2luZ0N0eCIsIl91c2luZ0N0eDIiLCJoYW5kbGUiLCJ1IiwicmVhZFRvRW5kIiwiXyIsImUiLCJkIl0sInNvdXJjZXMiOlsicmVzb3VyY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIHJlYWRBbGwob3Blbikge1xuICB1c2luZyBoYW5kbGUgPSBvcGVuKCk7XG4gIHJldHVybiBoYW5kbGUucmVhZFRvRW5kKCk7XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUFPLFNBQVNBLE9BQU9BLENBQUNDLElBQUk7RUFBRTtJQUFBLElBQUFDLFNBQUEsR0FBQUMsVUFBQTtJQUM1QixNQUFNQyxNQUFNLEdBQUFGLFNBQUEsQ0FBQUcsQ0FBQSxDQUFHSixJQUFJLENBQUMsQ0FBQztJQUNyQixPQUFPRyxNQUFNLENBQUNFLFNBQVMsQ0FBQyxDQUFDO0VBQUMsU0FBQUMsQ0FBQTtJQUFBTCxTQUFBLENBQUFNLENBQUEsR0FBQUQsQ0FBQTtFQUFBO0lBQUFMLFNBQUEsQ0FBQU8sQ0FBQTtFQUFBO0FBQzNCIiwiaWdub3JlTGlzdCI6W119