"use strict";var _csbRefreshUtils = require("/node_modules/__csb_bust/refresh-helper.js");var prevRefreshReg = window.$RefreshReg$;var prevRefreshSig = window.$RefreshSig$;_csbRefreshUtils.prelude(module);
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = MDXContent;
var _MDXProvider = require("@immediately-run/sdk/MDXProvider");
var _jsxRuntime = require("react/jsx-runtime");
/*@jsxRuntime automatic*/
/*@jsxImportSource react*/

function _createMdxContent(props) {
  const _components = {
      a: "a",
      h1: "h1",
      p: "p",
      ...(0, _MDXProvider.useMDXComponents)(),
      ...props.components
    },
    {
      HeadingAnchor,
      WikiLink
    } = _components;
  if (!HeadingAnchor) _missingMdxReference("HeadingAnchor", true);
  if (!WikiLink) _missingMdxReference("WikiLink", true, "13:9-13:45");
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
    children: [/*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.h1, {
      id: "esm-expressions-in-links",
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(HeadingAnchor, {
        id: "esm-expressions-in-links"
      }), "ESM expressions in links"]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["A link whose label is an evaluated expression:\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.a, {
        href: "http://mysite.com",
        children: dynamicLinkLabel()
      })]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["A markdown link whose destination looks dynamic is NOT evaluated — the brace text is\nliteral URL text: ", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.a, {
        href: "%7BdynamicUrl()%7D",
        children: "Click here"
      })]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["The supported dynamic-URL form is JSX: ", /*#__PURE__*/(0, _jsxRuntime.jsx)("a", {
        href: dynamicUrl(),
        children: "Click here"
      })]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["A dynamic wiki target is not supported — [[", someFilename(), "]] is not a wiki-link;\nuse JSX ", /*#__PURE__*/(0, _jsxRuntime.jsx)(WikiLink, {
        target: someFilename()
      }), " instead."]
    })]
  });
}
function MDXContent(props = {}) {
  const {
    wrapper: MDXLayout
  } = {
    ...(0, _MDXProvider.useMDXComponents)(),
    ...props.components
  };
  return MDXLayout ? /*#__PURE__*/(0, _jsxRuntime.jsx)(MDXLayout, {
    ...props,
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_createMdxContent, {
      ...props
    })
  }) : _createMdxContent(props);
}
_c = MDXContent;
function _missingMdxReference(id, component, place) {
  throw new Error("Expected " + (component ? "component" : "object") + " `" + id + "` to be defined: you likely forgot to import, pass, or provide it." + (place ? "\nIt’s referenced in your code at `" + place + "` in `/app/content/esm-links.mdx`" : ""));
}
var _c;
$RefreshReg$(_c, "MDXContent");

_csbRefreshUtils.postlude(module);
window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcHJvdmlkZUNvbXBvbmVudHMiXSwic291cmNlcyI6WyJlc20tbGlua3MubWR4Il0sInNvdXJjZXNDb250ZW50IjpbIi8qQGpzeFJ1bnRpbWUgYXV0b21hdGljKi9cbi8qQGpzeEltcG9ydFNvdXJjZSByZWFjdCovXG5pbXBvcnQge3VzZU1EWENvbXBvbmVudHMgYXMgX3Byb3ZpZGVDb21wb25lbnRzfSBmcm9tIFwiQGltbWVkaWF0ZWx5LXJ1bi9zZGsvTURYUHJvdmlkZXJcIjtcbmZ1bmN0aW9uIF9jcmVhdGVNZHhDb250ZW50KHByb3BzKSB7XG4gIGNvbnN0IF9jb21wb25lbnRzID0ge1xuICAgIGE6IFwiYVwiLFxuICAgIGgxOiBcImgxXCIsXG4gICAgcDogXCJwXCIsXG4gICAgLi4uX3Byb3ZpZGVDb21wb25lbnRzKCksXG4gICAgLi4ucHJvcHMuY29tcG9uZW50c1xuICB9LCB7SGVhZGluZ0FuY2hvciwgV2lraUxpbmt9ID0gX2NvbXBvbmVudHM7XG4gIGlmICghSGVhZGluZ0FuY2hvcikgX21pc3NpbmdNZHhSZWZlcmVuY2UoXCJIZWFkaW5nQW5jaG9yXCIsIHRydWUpO1xuICBpZiAoIVdpa2lMaW5rKSBfbWlzc2luZ01keFJlZmVyZW5jZShcIldpa2lMaW5rXCIsIHRydWUsIFwiMTM6OS0xMzo0NVwiKTtcbiAgcmV0dXJuIDw+PF9jb21wb25lbnRzLmgxIGlkPVwiZXNtLWV4cHJlc3Npb25zLWluLWxpbmtzXCI+PEhlYWRpbmdBbmNob3IgaWQ9XCJlc20tZXhwcmVzc2lvbnMtaW4tbGlua3NcIiAvPntcIkVTTSBleHByZXNzaW9ucyBpbiBsaW5rc1wifTwvX2NvbXBvbmVudHMuaDE+e1wiXFxuXCJ9PF9jb21wb25lbnRzLnA+e1wiQSBsaW5rIHdob3NlIGxhYmVsIGlzIGFuIGV2YWx1YXRlZCBleHByZXNzaW9uOlxcblwifTxfY29tcG9uZW50cy5hIGhyZWY9XCJodHRwOi8vbXlzaXRlLmNvbVwiPntkeW5hbWljTGlua0xhYmVsKCl9PC9fY29tcG9uZW50cy5hPjwvX2NvbXBvbmVudHMucD57XCJcXG5cIn08X2NvbXBvbmVudHMucD57XCJBIG1hcmtkb3duIGxpbmsgd2hvc2UgZGVzdGluYXRpb24gbG9va3MgZHluYW1pYyBpcyBOT1QgZXZhbHVhdGVkIOKAlCB0aGUgYnJhY2UgdGV4dCBpc1xcbmxpdGVyYWwgVVJMIHRleHQ6IFwifTxfY29tcG9uZW50cy5hIGhyZWY9XCIlN0JkeW5hbWljVXJsKCklN0RcIj57XCJDbGljayBoZXJlXCJ9PC9fY29tcG9uZW50cy5hPjwvX2NvbXBvbmVudHMucD57XCJcXG5cIn08X2NvbXBvbmVudHMucD57XCJUaGUgc3VwcG9ydGVkIGR5bmFtaWMtVVJMIGZvcm0gaXMgSlNYOiBcIn08YSBocmVmPXtkeW5hbWljVXJsKCl9PntcIkNsaWNrIGhlcmVcIn08L2E+PC9fY29tcG9uZW50cy5wPntcIlxcblwifTxfY29tcG9uZW50cy5wPntcIkEgZHluYW1pYyB3aWtpIHRhcmdldCBpcyBub3Qgc3VwcG9ydGVkIOKAlCBbW1wifXtzb21lRmlsZW5hbWUoKX17XCJdXSBpcyBub3QgYSB3aWtpLWxpbms7XFxudXNlIEpTWCBcIn08V2lraUxpbmsgdGFyZ2V0PXtzb21lRmlsZW5hbWUoKX0gLz57XCIgaW5zdGVhZC5cIn08L19jb21wb25lbnRzLnA+PC8+O1xufVxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTURYQ29udGVudChwcm9wcyA9IHt9KSB7XG4gIGNvbnN0IHt3cmFwcGVyOiBNRFhMYXlvdXR9ID0ge1xuICAgIC4uLl9wcm92aWRlQ29tcG9uZW50cygpLFxuICAgIC4uLnByb3BzLmNvbXBvbmVudHNcbiAgfTtcbiAgcmV0dXJuIE1EWExheW91dCA/IDxNRFhMYXlvdXQgey4uLnByb3BzfT48X2NyZWF0ZU1keENvbnRlbnQgey4uLnByb3BzfSAvPjwvTURYTGF5b3V0PiA6IF9jcmVhdGVNZHhDb250ZW50KHByb3BzKTtcbn1cbmZ1bmN0aW9uIF9taXNzaW5nTWR4UmVmZXJlbmNlKGlkLCBjb21wb25lbnQsIHBsYWNlKSB7XG4gIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIFwiICsgKGNvbXBvbmVudCA/IFwiY29tcG9uZW50XCIgOiBcIm9iamVjdFwiKSArIFwiIGBcIiArIGlkICsgXCJgIHRvIGJlIGRlZmluZWQ6IHlvdSBsaWtlbHkgZm9yZ290IHRvIGltcG9ydCwgcGFzcywgb3IgcHJvdmlkZSBpdC5cIiArIChwbGFjZSA/IFwiXFxuSXTigJlzIHJlZmVyZW5jZWQgaW4geW91ciBjb2RlIGF0IGBcIiArIHBsYWNlICsgXCJgIGluIGAvYXBwL2NvbnRlbnQvZXNtLWxpbmtzLm1keGBcIiA6IFwiXCIpKTtcbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUVBO0FBQXdGO0FBRnhGO0FBQ0E7O0FBRUEsU0FBUyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUU7RUFDaEMsTUFBTSxXQUFXLEdBQUc7TUFDbEIsQ0FBQyxFQUFFLEdBQUc7TUFDTixFQUFFLEVBQUUsSUFBSTtNQUNSLENBQUMsRUFBRSxHQUFHO01BQ04sR0FBRyxJQUFBQSw2QkFBa0IsRUFBQyxDQUFDO01BQ3ZCLEdBQUcsS0FBSyxDQUFDO0lBQ1gsQ0FBQztJQUFFO01BQUMsYUFBYTtNQUFFO0lBQVEsQ0FBQyxHQUFHLFdBQVc7RUFDMUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxvQkFBb0IsQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDO0VBQy9ELElBQUksQ0FBQyxRQUFRLEVBQUUsb0JBQW9CLENBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxZQUFZLENBQUM7RUFDbkUsb0JBQU87SUFBQSx3QkFBRSxzQkFBQyxXQUFXLENBQUMsRUFBRTtNQUFDLEVBQUUsRUFBQywwQkFBMEI7TUFBQSx3QkFBQyxxQkFBQyxhQUFhO1FBQUMsRUFBRSxFQUFDO01BQTBCLENBQUUsQ0FBQyxFQUFDLDBCQUEwQjtJQUFBLENBQWlCLENBQUMsRUFBQyxJQUFJLGVBQUMsc0JBQUMsV0FBVyxDQUFDLENBQUM7TUFBQSxXQUFFLGtEQUFrRCxlQUFDLHFCQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQUMsSUFBSSxFQUFDLG1CQUFtQjtRQUFBLFVBQUUsZ0JBQWdCLENBQUM7TUFBQyxDQUFnQixDQUFDO0lBQUEsQ0FBZSxDQUFDLEVBQUMsSUFBSSxlQUFDLHNCQUFDLFdBQVcsQ0FBQyxDQUFDO01BQUEsV0FBRSwwR0FBMEcsZUFBQyxxQkFBQyxXQUFXLENBQUMsQ0FBQztRQUFDLElBQUksRUFBQyxvQkFBb0I7UUFBQSxVQUFFO01BQVksQ0FBZ0IsQ0FBQztJQUFBLENBQWUsQ0FBQyxFQUFDLElBQUksZUFBQyxzQkFBQyxXQUFXLENBQUMsQ0FBQztNQUFBLFdBQUUseUNBQXlDLGVBQUM7UUFBRyxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUU7UUFBQSxVQUFFO01BQVksQ0FBSSxDQUFDO0lBQUEsQ0FBZSxDQUFDLEVBQUMsSUFBSSxlQUFDLHNCQUFDLFdBQVcsQ0FBQyxDQUFDO01BQUEsV0FBRSw2Q0FBNkMsRUFBRSxZQUFZLENBQUMsQ0FBQyxFQUFFLGtDQUFrQyxlQUFDLHFCQUFDLFFBQVE7UUFBQyxNQUFNLEVBQUUsWUFBWSxDQUFDO01BQUUsQ0FBRSxDQUFDLEVBQUMsV0FBVztJQUFBLENBQWdCLENBQUM7RUFBQSxDQUFFLENBQUM7QUFDdjBCO0FBQ2UsU0FBUyxVQUFVLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxFQUFFO0VBQzdDLE1BQU07SUFBQyxPQUFPLEVBQUU7RUFBUyxDQUFDLEdBQUc7SUFDM0IsR0FBRyxJQUFBQSw2QkFBa0IsRUFBQyxDQUFDO0lBQ3ZCLEdBQUcsS0FBSyxDQUFDO0VBQ1gsQ0FBQztFQUNELE9BQU8sU0FBUyxnQkFBRyxxQkFBQyxTQUFTO0lBQUEsR0FBSyxLQUFLO0lBQUEsdUJBQUUscUJBQUMsaUJBQWlCO01BQUEsR0FBSztJQUFLLENBQUc7RUFBQyxDQUFXLENBQUMsR0FBRyxpQkFBaUIsQ0FBQyxLQUFLLENBQUM7QUFDbEg7QUFBQyxLQU51QixVQUFVO0FBT2xDLFNBQVMsb0JBQW9CLENBQUMsRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUU7RUFDbEQsTUFBTSxJQUFJLEtBQUssQ0FBQyxXQUFXLElBQUksU0FBUyxHQUFHLFdBQVcsR0FBRyxRQUFRLENBQUMsR0FBRyxJQUFJLEdBQUcsRUFBRSxHQUFHLG9FQUFvRSxJQUFJLEtBQUssR0FBRyxxQ0FBcUMsR0FBRyxLQUFLLEdBQUcsbUNBQW1DLEdBQUcsRUFBRSxDQUFDLENBQUM7QUFDN1A7QUFBQztBQUFBIiwiaWdub3JlTGlzdCI6W119