"use strict";var _csbRefreshUtils = require("/node_modules/__csb_bust/refresh-helper.js");var prevRefreshReg = window.$RefreshReg$;var prevRefreshSig = window.$RefreshSig$;_csbRefreshUtils.prelude(module);
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = App;
var _react = require("react");
var _jsxRuntime = require("react/jsx-runtime");
var _s = $RefreshSig$();
function App({
  initial
}) {
  _s();
  const [count, setCount] = (0, _react.useState)(initial);
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)("main", {
    className: "app",
    children: [/*#__PURE__*/(0, _jsxRuntime.jsxs)("h1", {
      children: ["count is ", count, "."]
    }), /*#__PURE__*/(0, _jsxRuntime.jsx)("button", {
      onClick: () => setCount(c => c + 1),
      children: "increment"
    })]
  });
}
_s(App, "fas42Yw+PoMJp/kPAuVho9IBnmY=");
_c = App;
var _c;
$RefreshReg$(_c, "App");

_csbRefreshUtils.postlude(module);
window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJ1c2VTdGF0ZSJdLCJzb3VyY2VzIjpbIkFwcC50c3giXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgdXNlU3RhdGUgfSBmcm9tICdyZWFjdCc7XG5cbmludGVyZmFjZSBQcm9wcyB7XG4gIGluaXRpYWw6IG51bWJlcjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQXBwKHsgaW5pdGlhbCB9OiBQcm9wcykge1xuICBjb25zdCBbY291bnQsIHNldENvdW50XSA9IHVzZVN0YXRlKGluaXRpYWwpO1xuICByZXR1cm4gKFxuICAgIDxtYWluIGNsYXNzTmFtZT1cImFwcFwiPlxuICAgICAgPGgxPmNvdW50IGlzIHtjb3VudH0uPC9oMT5cbiAgICAgIDxidXR0b24gb25DbGljaz17KCkgPT4gc2V0Q291bnQoKGMpID0+IGMgKyAxKX0+aW5jcmVtZW50PC9idXR0b24+XG4gICAgPC9tYWluPlxuICApO1xufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7QUFBaUM7QUFBQTtBQU1sQixTQUFTLEdBQUcsQ0FBQztFQUFFO0FBQWUsQ0FBQyxFQUFFO0VBQUE7RUFDOUMsTUFBTSxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsR0FBRyxJQUFBQSxPQUFBLFFBQVEsRUFBQyxPQUFPLENBQUM7RUFDM0Msb0JBQ0U7SUFBTSxTQUFTLEVBQUMsS0FBSztJQUFBLHdCQUNuQjtNQUFBLFdBQUksV0FBUyxFQUFDLEtBQUssRUFBQyxHQUFDO0lBQUEsQ0FBSSxDQUFDLGVBQzFCO01BQVEsT0FBTyxFQUFFLE1BQU0sUUFBUSxDQUFFLENBQUMsSUFBSyxDQUFDLEdBQUcsQ0FBQyxDQUFFO01BQUEsVUFBQztJQUFTLENBQVEsQ0FBQztFQUFBLENBQzdELENBQUM7QUFFWDtBQUFDLEdBUnVCLEdBQUc7QUFBQSxLQUFILEdBQUc7QUFBQTtBQUFBIiwiaWdub3JlTGlzdCI6W119