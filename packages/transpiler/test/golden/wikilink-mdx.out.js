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
      code: "code",
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
      HeadingAnchor,
      WikiLink
    } = _components;
  if (!HeadingAnchor) _missingMdxReference("HeadingAnchor", true);
  if (!WikiLink) _missingMdxReference("WikiLink", true);
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
    children: [/*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.h1, {
      id: "wikilinks",
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(HeadingAnchor, {
        id: "wikilinks"
      }), "WikiLinks"]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["A bare relative link ", /*#__PURE__*/(0, _jsxRuntime.jsx)(WikiLink, {
        target: "another.mdx"
      }), " and a nested one ", /*#__PURE__*/(0, _jsxRuntime.jsx)(WikiLink, {
        target: "sub/dir/page.mdx"
      }), "."]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["An explicit label: ", /*#__PURE__*/(0, _jsxRuntime.jsx)(WikiLink, {
        target: "target.mdx",
        label: "My Favorite Link"
      }), "."]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["An absolute target ", /*#__PURE__*/(0, _jsxRuntime.jsx)(WikiLink, {
        target: "/app/docs/absolute/link.mdx"
      }), " taken verbatim."]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["Two on one line: ", /*#__PURE__*/(0, _jsxRuntime.jsx)(WikiLink, {
        target: "a.mdx"
      }), " and ", /*#__PURE__*/(0, _jsxRuntime.jsx)(WikiLink, {
        target: "b.mdx"
      }), "."]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["A wiki-link inside ", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.strong, {
        children: /*#__PURE__*/(0, _jsxRuntime.jsx)(WikiLink, {
          target: "bold.mdx"
        })
      }), " phrasing."]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.table, {
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_components.thead, {
        children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.tr, {
          children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_components.th, {
            children: "Column"
          }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.th, {
            children: "Link"
          })]
        })
      }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.tbody, {
        children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.tr, {
          children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_components.td, {
            children: "row"
          }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.td, {
            children: /*#__PURE__*/(0, _jsxRuntime.jsx)(WikiLink, {
              target: "celltarget.mdx",
              label: "label"
            })
          })]
        })
      })]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
      children: ["An ordinary ", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.a, {
        href: "https://example.com",
        children: "markdown link"
      }), " is untouched, and ", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.code, {
        children: "[[code]]"
      }), " in\nan inline code span stays literal."]
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
  throw new Error("Expected " + (component ? "component" : "object") + " `" + id + "` to be defined: you likely forgot to import, pass, or provide it." + (place ? "\nIt’s referenced in your code at `" + place + "` in `/app/content/wikilink.mdx`" : ""));
}
var _c;
$RefreshReg$(_c, "MDXContent");

_csbRefreshUtils.postlude(module);
window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfTURYUHJvdmlkZXIiLCJyZXF1aXJlIiwiX2pzeFJ1bnRpbWUiLCJfY3JlYXRlTWR4Q29udGVudCIsInByb3BzIiwiX2NvbXBvbmVudHMiLCJhIiwiY29kZSIsImgxIiwicCIsInN0cm9uZyIsInRhYmxlIiwidGJvZHkiLCJ0ZCIsInRoIiwidGhlYWQiLCJ0ciIsIl9wcm92aWRlQ29tcG9uZW50cyIsImNvbXBvbmVudHMiLCJIZWFkaW5nQW5jaG9yIiwiV2lraUxpbmsiLCJfbWlzc2luZ01keFJlZmVyZW5jZSIsImpzeHMiLCJGcmFnbWVudCIsImNoaWxkcmVuIiwiaWQiLCJqc3giLCJ0YXJnZXQiLCJsYWJlbCIsImhyZWYiLCJNRFhDb250ZW50Iiwid3JhcHBlciIsIk1EWExheW91dCIsIl9jIiwiY29tcG9uZW50IiwicGxhY2UiLCJFcnJvciIsIiRSZWZyZXNoUmVnJCJdLCJzb3VyY2VzIjpbIndpa2lsaW5rLm1keCJdLCJzb3VyY2VzQ29udGVudCI6WyIvKkBqc3hSdW50aW1lIGF1dG9tYXRpYyovXG4vKkBqc3hJbXBvcnRTb3VyY2UgcmVhY3QqL1xuaW1wb3J0IHt1c2VNRFhDb21wb25lbnRzIGFzIF9wcm92aWRlQ29tcG9uZW50c30gZnJvbSBcIkBpbW1lZGlhdGVseS1ydW4vc2RrL01EWFByb3ZpZGVyXCI7XG5mdW5jdGlvbiBfY3JlYXRlTWR4Q29udGVudChwcm9wcykge1xuICBjb25zdCBfY29tcG9uZW50cyA9IHtcbiAgICBhOiBcImFcIixcbiAgICBjb2RlOiBcImNvZGVcIixcbiAgICBoMTogXCJoMVwiLFxuICAgIHA6IFwicFwiLFxuICAgIHN0cm9uZzogXCJzdHJvbmdcIixcbiAgICB0YWJsZTogXCJ0YWJsZVwiLFxuICAgIHRib2R5OiBcInRib2R5XCIsXG4gICAgdGQ6IFwidGRcIixcbiAgICB0aDogXCJ0aFwiLFxuICAgIHRoZWFkOiBcInRoZWFkXCIsXG4gICAgdHI6IFwidHJcIixcbiAgICAuLi5fcHJvdmlkZUNvbXBvbmVudHMoKSxcbiAgICAuLi5wcm9wcy5jb21wb25lbnRzXG4gIH0sIHtIZWFkaW5nQW5jaG9yLCBXaWtpTGlua30gPSBfY29tcG9uZW50cztcbiAgaWYgKCFIZWFkaW5nQW5jaG9yKSBfbWlzc2luZ01keFJlZmVyZW5jZShcIkhlYWRpbmdBbmNob3JcIiwgdHJ1ZSk7XG4gIGlmICghV2lraUxpbmspIF9taXNzaW5nTWR4UmVmZXJlbmNlKFwiV2lraUxpbmtcIiwgdHJ1ZSk7XG4gIHJldHVybiA8PjxfY29tcG9uZW50cy5oMSBpZD1cIndpa2lsaW5rc1wiPjxIZWFkaW5nQW5jaG9yIGlkPVwid2lraWxpbmtzXCIgLz57XCJXaWtpTGlua3NcIn08L19jb21wb25lbnRzLmgxPntcIlxcblwifTxfY29tcG9uZW50cy5wPntcIkEgYmFyZSByZWxhdGl2ZSBsaW5rIFwifTxXaWtpTGluayB0YXJnZXQ9XCJhbm90aGVyLm1keFwiIC8+e1wiIGFuZCBhIG5lc3RlZCBvbmUgXCJ9PFdpa2lMaW5rIHRhcmdldD1cInN1Yi9kaXIvcGFnZS5tZHhcIiAvPntcIi5cIn08L19jb21wb25lbnRzLnA+e1wiXFxuXCJ9PF9jb21wb25lbnRzLnA+e1wiQW4gZXhwbGljaXQgbGFiZWw6IFwifTxXaWtpTGluayB0YXJnZXQ9XCJ0YXJnZXQubWR4XCIgbGFiZWw9XCJNeSBGYXZvcml0ZSBMaW5rXCIgLz57XCIuXCJ9PC9fY29tcG9uZW50cy5wPntcIlxcblwifTxfY29tcG9uZW50cy5wPntcIkFuIGFic29sdXRlIHRhcmdldCBcIn08V2lraUxpbmsgdGFyZ2V0PVwiL2FwcC9kb2NzL2Fic29sdXRlL2xpbmsubWR4XCIgLz57XCIgdGFrZW4gdmVyYmF0aW0uXCJ9PC9fY29tcG9uZW50cy5wPntcIlxcblwifTxfY29tcG9uZW50cy5wPntcIlR3byBvbiBvbmUgbGluZTogXCJ9PFdpa2lMaW5rIHRhcmdldD1cImEubWR4XCIgLz57XCIgYW5kIFwifTxXaWtpTGluayB0YXJnZXQ9XCJiLm1keFwiIC8+e1wiLlwifTwvX2NvbXBvbmVudHMucD57XCJcXG5cIn08X2NvbXBvbmVudHMucD57XCJBIHdpa2ktbGluayBpbnNpZGUgXCJ9PF9jb21wb25lbnRzLnN0cm9uZz48V2lraUxpbmsgdGFyZ2V0PVwiYm9sZC5tZHhcIiAvPjwvX2NvbXBvbmVudHMuc3Ryb25nPntcIiBwaHJhc2luZy5cIn08L19jb21wb25lbnRzLnA+e1wiXFxuXCJ9PF9jb21wb25lbnRzLnRhYmxlPjxfY29tcG9uZW50cy50aGVhZD48X2NvbXBvbmVudHMudHI+PF9jb21wb25lbnRzLnRoPntcIkNvbHVtblwifTwvX2NvbXBvbmVudHMudGg+PF9jb21wb25lbnRzLnRoPntcIkxpbmtcIn08L19jb21wb25lbnRzLnRoPjwvX2NvbXBvbmVudHMudHI+PC9fY29tcG9uZW50cy50aGVhZD48X2NvbXBvbmVudHMudGJvZHk+PF9jb21wb25lbnRzLnRyPjxfY29tcG9uZW50cy50ZD57XCJyb3dcIn08L19jb21wb25lbnRzLnRkPjxfY29tcG9uZW50cy50ZD48V2lraUxpbmsgdGFyZ2V0PVwiY2VsbHRhcmdldC5tZHhcIiBsYWJlbD1cImxhYmVsXCIgLz48L19jb21wb25lbnRzLnRkPjwvX2NvbXBvbmVudHMudHI+PC9fY29tcG9uZW50cy50Ym9keT48L19jb21wb25lbnRzLnRhYmxlPntcIlxcblwifTxfY29tcG9uZW50cy5wPntcIkFuIG9yZGluYXJ5IFwifTxfY29tcG9uZW50cy5hIGhyZWY9XCJodHRwczovL2V4YW1wbGUuY29tXCI+e1wibWFya2Rvd24gbGlua1wifTwvX2NvbXBvbmVudHMuYT57XCIgaXMgdW50b3VjaGVkLCBhbmQgXCJ9PF9jb21wb25lbnRzLmNvZGU+e1wiW1tjb2RlXV1cIn08L19jb21wb25lbnRzLmNvZGU+e1wiIGluXFxuYW4gaW5saW5lIGNvZGUgc3BhbiBzdGF5cyBsaXRlcmFsLlwifTwvX2NvbXBvbmVudHMucD48Lz47XG59XG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBNRFhDb250ZW50KHByb3BzID0ge30pIHtcbiAgY29uc3Qge3dyYXBwZXI6IE1EWExheW91dH0gPSB7XG4gICAgLi4uX3Byb3ZpZGVDb21wb25lbnRzKCksXG4gICAgLi4ucHJvcHMuY29tcG9uZW50c1xuICB9O1xuICByZXR1cm4gTURYTGF5b3V0ID8gPE1EWExheW91dCB7Li4ucHJvcHN9PjxfY3JlYXRlTWR4Q29udGVudCB7Li4ucHJvcHN9IC8+PC9NRFhMYXlvdXQ+IDogX2NyZWF0ZU1keENvbnRlbnQocHJvcHMpO1xufVxuZnVuY3Rpb24gX21pc3NpbmdNZHhSZWZlcmVuY2UoaWQsIGNvbXBvbmVudCwgcGxhY2UpIHtcbiAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgXCIgKyAoY29tcG9uZW50ID8gXCJjb21wb25lbnRcIiA6IFwib2JqZWN0XCIpICsgXCIgYFwiICsgaWQgKyBcImAgdG8gYmUgZGVmaW5lZDogeW91IGxpa2VseSBmb3Jnb3QgdG8gaW1wb3J0LCBwYXNzLCBvciBwcm92aWRlIGl0LlwiICsgKHBsYWNlID8gXCJcXG5JdOKAmXMgcmVmZXJlbmNlZCBpbiB5b3VyIGNvZGUgYXQgYFwiICsgcGxhY2UgKyBcImAgaW4gYC9hcHAvY29udGVudC93aWtpbGluay5tZHhgXCIgOiBcIlwiKSk7XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUVBLElBQUFBLFlBQUEsR0FBQUMsT0FBQTtBQUF3RixJQUFBQyxXQUFBLEdBQUFELE9BQUE7QUFGeEY7QUFDQTs7QUFFQSxTQUFTRSxpQkFBaUJBLENBQUNDLEtBQUssRUFBRTtFQUNoQyxNQUFNQyxXQUFXLEdBQUc7TUFDbEJDLENBQUMsRUFBRSxHQUFHO01BQ05DLElBQUksRUFBRSxNQUFNO01BQ1pDLEVBQUUsRUFBRSxJQUFJO01BQ1JDLENBQUMsRUFBRSxHQUFHO01BQ05DLE1BQU0sRUFBRSxRQUFRO01BQ2hCQyxLQUFLLEVBQUUsT0FBTztNQUNkQyxLQUFLLEVBQUUsT0FBTztNQUNkQyxFQUFFLEVBQUUsSUFBSTtNQUNSQyxFQUFFLEVBQUUsSUFBSTtNQUNSQyxLQUFLLEVBQUUsT0FBTztNQUNkQyxFQUFFLEVBQUUs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