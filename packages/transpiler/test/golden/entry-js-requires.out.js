"use strict";var _csbRefreshUtils = require("/node_modules/__csb_bust/refresh-helper.js");var prevRefreshReg = window.$RefreshReg$;var prevRefreshSig = window.$RefreshSig$;_csbRefreshUtils.prelude(module);
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.bootstrap = bootstrap;
const {
  clamp
} = require('./helpers');
const config = require('./config.json');
function bootstrap(value) {
  return clamp(value, config.min, config.max);
}

_csbRefreshUtils.postlude(module);
window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiZW50cnkuanMiXSwic291cmNlc0NvbnRlbnQiOlsiY29uc3QgeyBjbGFtcCB9ID0gcmVxdWlyZSgnLi9oZWxwZXJzJyk7XG5jb25zdCBjb25maWcgPSByZXF1aXJlKCcuL2NvbmZpZy5qc29uJyk7XG5cbmV4cG9ydCBmdW5jdGlvbiBib290c3RyYXAodmFsdWUpIHtcbiAgcmV0dXJuIGNsYW1wKHZhbHVlLCBjb25maWcubWluLCBjb25maWcubWF4KTtcbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBLE1BQU07RUFBRTtBQUFNLENBQUMsR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFDO0FBQ3RDLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxlQUFlLENBQUM7QUFFaEMsU0FBUyxTQUFTLENBQUMsS0FBSyxFQUFFO0VBQy9CLE9BQU8sS0FBSyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUM7QUFDN0MiLCJpZ25vcmVMaXN0IjpbXX0=