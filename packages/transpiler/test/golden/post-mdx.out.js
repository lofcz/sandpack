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
      del: "del",
      h1: "h1",
      p: "p",
      strong: "strong",
      table: "table",
      tbody: "tbody",
      td: "td",
      th: "th",
      thead: "thead",
      tr: "tr",
      ...(0, _MDXProvider.useMDXComponents)(),
      ...props.components
    },
    {
      Callout,
      HeadingAnchor
    } = _components;
  if (!Callout) _missingMdxReference("Callout", true, "6:1-6:50");
  if (!HeadingAnchor) _missingMdxReference("HeadingAnchor", true);
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
    children: [/*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.h1, {
      id: "section",
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(HeadingAnchor, {
        id: "section"
      }), props.title ?? 'Hello']
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["This is ", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.strong, {
        children: "MDX"
      }), " with a ", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.a, {
        href: "https://example.com",
        children: "link"
      }), " and GFM ", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.del, {
        children: "strikethrough"
      }), "."]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(Callout, {
      children: "Rendered through the provider."
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.table, {
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_components.thead, {
        children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.tr, {
          children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_components.th, {
            children: "a"
          }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.th, {
            children: "b"
          })]
        })
      }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.tbody, {
        children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.tr, {
          children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_components.td, {
            children: "1"
          }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.td, {
            children: "2"
          })]
        })
      })]
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
  throw new Error("Expected " + (component ? "component" : "object") + " `" + id + "` to be defined: you likely forgot to import, pass, or provide it." + (place ? "\nIt’s referenced in your code at `" + place + "` in `/app/content/post.mdx`" : ""));
}
var _c;
$RefreshReg$(_c, "MDXContent");

_csbRefreshUtils.postlude(module);
window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfTURYUHJvdmlkZXIiLCJyZXF1aXJlIiwiX2pzeFJ1bnRpbWUiLCJfY3JlYXRlTWR4Q29udGVudCIsInByb3BzIiwiX2NvbXBvbmVudHMiLCJhIiwiZGVsIiwiaDEiLCJwIiwic3Ryb25nIiwidGFibGUiLCJ0Ym9keSIsInRkIiwidGgiLCJ0aGVhZCIsInRyIiwiX3Byb3ZpZGVDb21wb25lbnRzIiwiY29tcG9uZW50cyIsIkNhbGxvdXQiLCJIZWFkaW5nQW5jaG9yIiwiX21pc3NpbmdNZHhSZWZlcmVuY2UiLCJqc3hzIiwiRnJhZ21lbnQiLCJjaGlsZHJlbiIsImlkIiwianN4IiwidGl0bGUiLCJocmVmIiwiTURYQ29udGVudCIsIndyYXBwZXIiLCJNRFhMYXlvdXQiLCJfYyIsImNvbXBvbmVudCIsInBsYWNlIiwiRXJyb3IiLCIkUmVmcmVzaFJlZyQiXSwic291cmNlcyI6WyJwb3N0Lm1keCJdLCJzb3VyY2VzQ29udGVudCI6WyIvKkBqc3hSdW50aW1lIGF1dG9tYXRpYyovXG4vKkBqc3hJbXBvcnRTb3VyY2UgcmVhY3QqL1xuaW1wb3J0IHt1c2VNRFhDb21wb25lbnRzIGFzIF9wcm92aWRlQ29tcG9uZW50c30gZnJvbSBcIkBpbW1lZGlhdGVseS1ydW4vc2RrL01EWFByb3ZpZGVyXCI7XG5mdW5jdGlvbiBfY3JlYXRlTWR4Q29udGVudChwcm9wcykge1xuICBjb25zdCBfY29tcG9uZW50cyA9IHtcbiAgICBhOiBcImFcIixcbiAgICBkZWw6IFwiZGVsXCIsXG4gICAgaDE6IFwiaDFcIixcbiAgICBwOiBcInBcIixcbiAgICBzdHJvbmc6IFwic3Ryb25nXCIsXG4gICAgdGFibGU6IFwidGFibGVcIixcbiAgICB0Ym9keTogXCJ0Ym9keVwiLFxuICAgIHRkOiBcInRkXCIsXG4gICAgdGg6IFwidGhcIixcbiAgICB0aGVhZDogXCJ0aGVhZFwiLFxuICAgIHRyOiBcInRyXCIsXG4gICAgLi4uX3Byb3ZpZGVDb21wb25lbnRzKCksXG4gICAgLi4ucHJvcHMuY29tcG9uZW50c1xuICB9LCB7Q2FsbG91dCwgSGVhZGluZ0FuY2hvcn0gPSBfY29tcG9uZW50cztcbiAgaWYgKCFDYWxsb3V0KSBfbWlzc2luZ01keFJlZmVyZW5jZShcIkNhbGxvdXRcIiwgdHJ1ZSwgXCI2OjEtNjo1MFwiKTtcbiAgaWYgKCFIZWFkaW5nQW5jaG9yKSBfbWlzc2luZ01keFJlZmVyZW5jZShcIkhlYWRpbmdBbmNob3JcIiwgdHJ1ZSk7XG4gIHJldHVybiA8PjxfY29tcG9uZW50cy5oMSBpZD1cInNlY3Rpb25cIj48SGVhZGluZ0FuY2hvciBpZD1cInNlY3Rpb25cIiAvPntwcm9wcy50aXRsZSA/PyAnSGVsbG8nfTwvX2NvbXBvbmVudHMuaDE+e1wiXFxuXCJ9PF9jb21wb25lbnRzLnA+e1wiVGhpcyBpcyBcIn08X2NvbXBvbmVudHMuc3Ryb25nPntcIk1EWFwifTwvX2NvbXBvbmVudHMuc3Ryb25nPntcIiB3aXRoIGEgXCJ9PF9jb21wb25lbnRzLmEgaHJlZj1cImh0dHBzOi8vZXhhbXBsZS5jb21cIj57XCJsaW5rXCJ9PC9fY29tcG9uZW50cy5hPntcIiBhbmQgR0ZNIFwifTxfY29tcG9uZW50cy5kZWw+e1wic3RyaWtldGhyb3VnaFwifTwvX2NvbXBvbmVudHMuZGVsPntcIi5cIn08L19jb21wb25lbnRzLnA+e1wiXFxuXCJ9PENhbGxvdXQ+e1wiUmVuZGVyZWQgdGhyb3VnaCB0aGUgcHJvdmlkZXIuXCJ9PC9DYWxsb3V0PntcIlxcblwifTxfY29tcG9uZW50cy50YWJsZT48X2NvbXBvbmVudHMudGhlYWQ+PF9jb21wb25lbnRzLnRyPjxfY29tcG9uZW50cy50aD57XCJhXCJ9PC9fY29tcG9uZW50cy50aD48X2NvbXBvbmVudHMudGg+e1wiYlwifTwvX2NvbXBvbmVudHMudGg+PC9fY29tcG9uZW50cy50cj48L19jb21wb25lbnRzLnRoZWFkPjxfY29tcG9uZW50cy50Ym9keT48X2NvbXBvbmVudHMudHI+PF9jb21wb25lbnRzLnRkPntcIjFcIn08L19jb21wb25lbnRzLnRkPjxfY29tcG9uZW50cy50ZD57XCIyXCJ9PC9fY29tcG9uZW50cy50ZD48L19jb21wb25lbnRzLnRyPjwvX2NvbXBvbmVudHMudGJvZHk+PC9fY29tcG9uZW50cy50YWJsZT48Lz47XG59XG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBNRFhDb250ZW50KHByb3BzID0ge30pIHtcbiAgY29uc3Qge3dyYXBwZXI6IE1EWExheW91dH0gPSB7XG4gICAgLi4uX3Byb3ZpZGVDb21wb25lbnRzKCksXG4gICAgLi4ucHJvcHMuY29tcG9uZW50c1xuICB9O1xuICByZXR1cm4gTURYTGF5b3V0ID8gPE1EWExheW91dCB7Li4ucHJvcHN9PjxfY3JlYXRlTWR4Q29udGVudCB7Li4ucHJvcHN9IC8+PC9NRFhMYXlvdXQ+IDogX2NyZWF0ZU1keENvbnRlbnQocHJvcHMpO1xufVxuZnVuY3Rpb24gX21pc3NpbmdNZHhSZWZlcmVuY2UoaWQsIGNvbXBvbmVudCwgcGxhY2UpIHtcbiAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgXCIgKyAoY29tcG9uZW50ID8gXCJjb21wb25lbnRcIiA6IFwib2JqZWN0XCIpICsgXCIgYFwiICsgaWQgKyBcImAgdG8gYmUgZGVmaW5lZDogeW91IGxpa2VseSBmb3Jnb3QgdG8gaW1wb3J0LCBwYXNzLCBvciBwcm92aWRlIGl0LlwiICsgKHBsYWNlID8gXCJcXG5JdOKAmXMgcmVmZXJlbmNlZCBpbiB5b3VyIGNvZGUgYXQgYFwiICsgcGxhY2UgKyBcImAgaW4gYC9hcHAvY29udGVudC9wb3N0Lm1keGBcIiA6IFwiXCIpKTtcbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBRUEsSUFBQUEsWUFBQSxHQUFBQyxPQUFBO0FBQXdGLElBQUFDLFdBQUEsR0FBQUQsT0FBQTtBQUZ4RjtBQUNBOztBQUVBLFNBQVNFLGlCQUFpQkEsQ0FBQ0MsS0FBSyxFQUFFO0VBQ2hDLE1BQU1DLFdBQVcsR0FBRztNQUNsQkMsQ0FBQyxFQUFFLEdBQUc7TUFDTkMsR0FBRyxFQUFFLEtBQUs7TUFDVkMsRUFBRSxFQUFF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