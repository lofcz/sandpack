var _csbRefreshUtils = require("/node_modules/__csb_bust/refresh-helper.js");var prevRefreshReg = window.$RefreshReg$;var prevRefreshSig = window.$RefreshSig$;_csbRefreshUtils.prelude(module);"use strict";

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfTURYUHJvdmlkZXIiLCJyZXF1aXJlIiwiX2pzeFJ1bnRpbWUiLCJfY3JlYXRlTWR4Q29udGVudCIsInByb3BzIiwiX2NvbXBvbmVudHMiLCJhIiwiaDEiLCJwIiwiX3Byb3ZpZGVDb21wb25lbnRzIiwiY29tcG9uZW50cyIsIkhlYWRpbmdBbmNob3IiLCJXaWtpTGluayIsIl9taXNzaW5nTWR4UmVmZXJlbmNlIiwianN4cyIsIkZyYWdtZW50IiwiY2hpbGRyZW4iLCJpZCIsImpzeCIsImhyZWYiLCJkeW5hbWljTGlua0xhYmVsIiwiZHluYW1pY1VybCIsInNvbWVGaWxlbmFtZSIsInRhcmdldCIsIk1EWENvbnRlbnQiLCJ3cmFwcGVyIiwiTURYTGF5b3V0IiwiX2MiLCJjb21wb25lbnQiLCJwbGFjZSIsIkVycm9yIiwiJFJlZnJlc2hSZWckIl0sInNvdXJjZXMiOlsiZXNtLWxpbmtzLm1keCJdLCJzb3VyY2VzQ29udGVudCI6WyIvKkBqc3hSdW50aW1lIGF1dG9tYXRpYyovXG4vKkBqc3hJbXBvcnRTb3VyY2UgcmVhY3QqL1xuaW1wb3J0IHt1c2VNRFhDb21wb25lbnRzIGFzIF9wcm92aWRlQ29tcG9uZW50c30gZnJvbSBcIkBpbW1lZGlhdGVseS1ydW4vc2RrL01EWFByb3ZpZGVyXCI7XG5mdW5jdGlvbiBfY3JlYXRlTWR4Q29udGVudChwcm9wcykge1xuICBjb25zdCBfY29tcG9uZW50cyA9IHtcbiAgICBhOiBcImFcIixcbiAgICBoMTogXCJoMVwiLFxuICAgIHA6IFwicFwiLFxuICAgIC4uLl9wcm92aWRlQ29tcG9uZW50cygpLFxuICAgIC4uLnByb3BzLmNvbXBvbmVudHNcbiAgfSwge0hlYWRpbmdBbmNob3IsIFdpa2lMaW5rfSA9IF9jb21wb25lbnRzO1xuICBpZiAoIUhlYWRpbmdBbmNob3IpIF9taXNzaW5nTWR4UmVmZXJlbmNlKFwiSGVhZGluZ0FuY2hvclwiLCB0cnVlKTtcbiAgaWYgKCFXaWtpTGluaykgX21pc3NpbmdNZHhSZWZlcmVuY2UoXCJXaWtpTGlua1wiLCB0cnVlLCBcIjEzOjktMTM6NDVcIik7XG4gIHJldHVybiA8PjxfY29tcG9uZW50cy5oMSBpZD1cImVzbS1leHByZXNzaW9ucy1pbi1saW5rc1wiPjxIZWFkaW5nQW5jaG9yIGlkPVwiZXNtLWV4cHJlc3Npb25zLWluLWxpbmtzXCIgLz57XCJFU00gZXhwcmVzc2lvbnMgaW4gbGlua3NcIn08L19jb21wb25lbnRzLmgxPntcIlxcblwifTxfY29tcG9uZW50cy5wPntcIkEgbGluayB3aG9zZSBsYWJlbCBpcyBhbiBldmFsdWF0ZWQgZXhwcmVzc2lvbjpcXG5cIn08X2NvbXBvbmVudHMuYSBocmVmPVwiaHR0cDovL215c2l0ZS5jb21cIj57ZHluYW1pY0xpbmtMYWJlbCgpfTwvX2NvbXBvbmVudHMuYT48L19jb21wb25lbnRzLnA+e1wiXFxuXCJ9PF9jb21wb25lbnRzLnA+e1wiQSBtYXJrZG93biBsaW5rIHdob3NlIGRlc3RpbmF0aW9uIGxvb2tzIGR5bmFtaWMgaXMgTk9UIGV2YWx1YXRlZCDigJQgdGhlIGJyYWNlIHRleHQgaXNcXG5saXRlcmFsIFVSTCB0ZXh0OiBcIn08X2NvbXBvbmVudHMuYSBocmVmPVwiJTdCZHluYW1pY1VybCgpJTdEXCI+e1wiQ2xpY2sgaGVyZVwifTwvX2NvbXBvbmVudHMuYT48L19jb21wb25lbnRzLnA+e1wiXFxuXCJ9PF9jb21wb25lbnRzLnA+e1wiVGhlIHN1cHBvcnRlZCBkeW5hbWljLVVSTCBmb3JtIGlzIEpTWDogXCJ9PGEgaHJlZj17ZHluYW1pY1VybCgpfT57XCJDbGljayBoZXJlXCJ9PC9hPjwvX2NvbXBvbmVudHMucD57XCJcXG5cIn08X2NvbXBvbmVudHMucD57XCJBIGR5bmFtaWMgd2lraSB0YXJnZXQgaXMgbm90IHN1cHBvcnRlZCDigJQgW1tcIn17c29tZUZpbGVuYW1lKCl9e1wiXV0gaXMgbm90IGEgd2lraS1saW5rO1xcbnVzZSBKU1ggXCJ9PFdpa2lMaW5rIHRhcmdldD17c29tZUZpbGVuYW1lKCl9IC8+e1wiIGluc3RlYWQuXCJ9PC9fY29tcG9uZW50cy5wPjwvPjtcbn1cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIE1EWENvbnRlbnQocHJvcHMgPSB7fSkge1xuICBjb25zdCB7d3JhcHBlcjogTURYTGF5b3V0fSA9IHtcbiAgICAuLi5fcHJvdmlkZUNvbXBvbmVudHMoKSxcbiAgICAuLi5wcm9wcy5jb21wb25lbnRzXG4gIH07XG4gIHJldHVybiBNRFhMYXlvdXQgPyA8TURYTGF5b3V0IHsuLi5wcm9wc30+PF9jcmVhdGVNZHhDb250ZW50IHsuLi5wcm9wc30gLz48L01EWExheW91dD4gOiBfY3JlYXRlTWR4Q29udGVudChwcm9wcyk7XG59XG5mdW5jdGlvbiBfbWlzc2luZ01keFJlZmVyZW5jZShpZCwgY29tcG9uZW50LCBwbGFjZSkge1xuICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBcIiArIChjb21wb25lbnQgPyBcImNvbXBvbmVudFwiIDogXCJvYmplY3RcIikgKyBcIiBgXCIgKyBpZCArIFwiYCB0byBiZSBkZWZpbmVkOiB5b3UgbGlrZWx5IGZvcmdvdCB0byBpbXBvcnQsIHBhc3MsIG9yIHByb3ZpZGUgaXQuXCIgKyAocGxhY2UgPyBcIlxcbkl04oCZcyByZWZlcmVuY2VkIGluIHlvdXIgY29kZSBhdCBgXCIgKyBwbGFjZSArIFwiYCBpbiBgL2FwcC9jb250ZW50L2VzbS1saW5rcy5tZHhgXCIgOiBcIlwiKSk7XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUVBLElBQUFBLFlBQUEsR0FBQUMsT0FBQTtBQUF3RixJQUFBQyxXQUFBLEdBQUFELE9BQUE7QUFGeEY7QUFDQTs7QUFFQSxTQUFTRSxpQkFBaUJBLENBQUNDLEtBQUssRUFBRTtFQUNoQyxNQUFNQyxXQUFXLEdBQUc7TUFDbEJDLENBQUMsRUFBRSxHQUFHO01BQ05DLEVBQUUsRUFBRSxJQUFJO01BQ1JDLENBQUMsRUFBRSxHQUFHO01BQ04sR0FBRyxJQUFBQyw2QkFBa0IsRUFBQyxDQUFDO01BQ3ZCLEdBQUdMLEtBQUssQ0FBQ007SUFDWCxD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