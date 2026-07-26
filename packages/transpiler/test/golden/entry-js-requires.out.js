var _csbRefreshUtils = require("/node_modules/__csb_bust/refresh-helper.js");var prevRefreshReg = window.$RefreshReg$;var prevRefreshSig = window.$RefreshSig$;_csbRefreshUtils.prelude(module);"use strict";

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjbGFtcCIsInJlcXVpcmUiLCJjb25maWciLCJib290c3RyYXAiLCJ2YWx1ZSIsIm1pbiIsIm1heCJdLCJzb3VyY2VzIjpbImVudHJ5LmpzIl0sInNvdXJjZXNDb250ZW50IjpbImNvbnN0IHsgY2xhbXAgfSA9IHJlcXVpcmUoJy4vaGVscGVycycpO1xuY29uc3QgY29uZmlnID0gcmVxdWlyZSgnLi9jb25maWcuanNvbicpO1xuXG5leHBvcnQgZnVuY3Rpb24gYm9vdHN0cmFwKHZhbHVlKSB7XG4gIHJldHVybiBjbGFtcCh2YWx1ZSwgY29uZmlnLm1pbiwgY29uZmlnLm1heCk7XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLE1BQU07RUFBRUE7QUFBTSxDQUFDLEdBQUdDLE9BQU8sQ0FBQyxXQUFXLENBQUM7QUFDdEMsTUFBTUMsTUFBTSxHQUFHRCxPQUFPLENBQUMsZUFBZSxDQUFDO0FBRWhDLFNBQVNFLFNBQVNBLENBQUNDLEtBQUssRUFBRTtFQUMvQixPQUFPSixLQUFLLENBQUNJLEtBQUssRUFBRUYsTUFBTSxDQUFDRyxHQUFHLEVBQUVILE1BQU0sQ0FBQ0ksR0FBRyxDQUFDO0FBQzdDIiwiaWdub3JlTGlzdCI6W119