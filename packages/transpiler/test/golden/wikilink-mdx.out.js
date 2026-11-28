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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcHJvdmlkZUNvbXBvbmVudHMiXSwic291cmNlcyI6WyJ3aWtpbGluay5tZHgiXSwic291cmNlc0NvbnRlbnQiOlsiLypAanN4UnVudGltZSBhdXRvbWF0aWMqL1xuLypAanN4SW1wb3J0U291cmNlIHJlYWN0Ki9cbmltcG9ydCB7dXNlTURYQ29tcG9uZW50cyBhcyBfcHJvdmlkZUNvbXBvbmVudHN9IGZyb20gXCJAaW1tZWRpYXRlbHktcnVuL3Nkay9NRFhQcm92aWRlclwiO1xuZnVuY3Rpb24gX2NyZWF0ZU1keENvbnRlbnQocHJvcHMpIHtcbiAgY29uc3QgX2NvbXBvbmVudHMgPSB7XG4gICAgYTogXCJhXCIsXG4gICAgY29kZTogXCJjb2RlXCIsXG4gICAgaDE6IFwiaDFcIixcbiAgICBwOiBcInBcIixcbiAgICBzdHJvbmc6IFwic3Ryb25nXCIsXG4gICAgdGFibGU6IFwidGFibGVcIixcbiAgICB0Ym9keTogXCJ0Ym9keVwiLFxuICAgIHRkOiBcInRkXCIsXG4gICAgdGg6IFwidGhcIixcbiAgICB0aGVhZDogXCJ0aGVhZFwiLFxuICAgIHRyOiBcInRyXCIsXG4gICAgLi4uX3Byb3ZpZGVDb21wb25lbnRzKCksXG4gICAgLi4ucHJvcHMuY29tcG9uZW50c1xuICB9LCB7SGVhZGluZ0FuY2hvciwgV2lraUxpbmt9ID0gX2NvbXBvbmVudHM7XG4gIGlmICghSGVhZGluZ0FuY2hvcikgX21pc3NpbmdNZHhSZWZlcmVuY2UoXCJIZWFkaW5nQW5jaG9yXCIsIHRydWUpO1xuICBpZiAoIVdpa2lMaW5rKSBfbWlzc2luZ01keFJlZmVyZW5jZShcIldpa2lMaW5rXCIsIHRydWUpO1xuICByZXR1cm4gPD48X2NvbXBvbmVudHMuaDEgaWQ9XCJ3aWtpbGlua3NcIj48SGVhZGluZ0FuY2hvciBpZD1cIndpa2lsaW5rc1wiIC8+e1wiV2lraUxpbmtzXCJ9PC9fY29tcG9uZW50cy5oMT57XCJcXG5cIn08X2NvbXBvbmVudHMucD57XCJBIGJhcmUgcmVsYXRpdmUgbGluayBcIn08V2lraUxpbmsgdGFyZ2V0PVwiYW5vdGhlci5tZHhcIiAvPntcIiBhbmQgYSBuZXN0ZWQgb25lIFwifTxXaWtpTGluayB0YXJnZXQ9XCJzdWIvZGlyL3BhZ2UubWR4XCIgLz57XCIuXCJ9PC9fY29tcG9uZW50cy5wPntcIlxcblwifTxfY29tcG9uZW50cy5wPntcIkFuIGV4cGxpY2l0IGxhYmVsOiBcIn08V2lraUxpbmsgdGFyZ2V0PVwidGFyZ2V0Lm1keFwiIGxhYmVsPVwiTXkgRmF2b3JpdGUgTGlua1wiIC8+e1wiLlwifTwvX2NvbXBvbmVudHMucD57XCJcXG5cIn08X2NvbXBvbmVudHMucD57XCJBbiBhYnNvbHV0ZSB0YXJnZXQgXCJ9PFdpa2lMaW5rIHRhcmdldD1cIi9hcHAvZG9jcy9hYnNvbHV0ZS9saW5rLm1keFwiIC8+e1wiIHRha2VuIHZlcmJhdGltLlwifTwvX2NvbXBvbmVudHMucD57XCJcXG5cIn08X2NvbXBvbmVudHMucD57XCJUd28gb24gb25lIGxpbmU6IFwifTxXaWtpTGluayB0YXJnZXQ9XCJhLm1keFwiIC8+e1wiIGFuZCBcIn08V2lraUxpbmsgdGFyZ2V0PVwiYi5tZHhcIiAvPntcIi5cIn08L19jb21wb25lbnRzLnA+e1wiXFxuXCJ9PF9jb21wb25lbnRzLnA+e1wiQSB3aWtpLWxpbmsgaW5zaWRlIFwifTxfY29tcG9uZW50cy5zdHJvbmc+PFdpa2lMaW5rIHRhcmdldD1cImJvbGQubWR4XCIgLz48L19jb21wb25lbnRzLnN0cm9uZz57XCIgcGhyYXNpbmcuXCJ9PC9fY29tcG9uZW50cy5wPntcIlxcblwifTxfY29tcG9uZW50cy50YWJsZT48X2NvbXBvbmVudHMudGhlYWQ+PF9jb21wb25lbnRzLnRyPjxfY29tcG9uZW50cy50aD57XCJDb2x1bW5cIn08L19jb21wb25lbnRzLnRoPjxfY29tcG9uZW50cy50aD57XCJMaW5rXCJ9PC9fY29tcG9uZW50cy50aD48L19jb21wb25lbnRzLnRyPjwvX2NvbXBvbmVudHMudGhlYWQ+PF9jb21wb25lbnRzLnRib2R5PjxfY29tcG9uZW50cy50cj48X2NvbXBvbmVudHMudGQ+e1wicm93XCJ9PC9fY29tcG9uZW50cy50ZD48X2NvbXBvbmVudHMudGQ+PFdpa2lMaW5rIHRhcmdldD1cImNlbGx0YXJnZXQubWR4XCIgbGFiZWw9XCJsYWJlbFwiIC8+PC9fY29tcG9uZW50cy50ZD48L19jb21wb25lbnRzLnRyPjwvX2NvbXBvbmVudHMudGJvZHk+PC9fY29tcG9uZW50cy50YWJsZT57XCJcXG5cIn08X2NvbXBvbmVudHMucD57XCJBbiBvcmRpbmFyeSBcIn08X2NvbXBvbmVudHMuYSBocmVmPVwiaHR0cHM6Ly9leGFtcGxlLmNvbVwiPntcIm1hcmtkb3duIGxpbmtcIn08L19jb21wb25lbnRzLmE+e1wiIGlzIHVudG91Y2hlZCwgYW5kIFwifTxfY29tcG9uZW50cy5jb2RlPntcIltbY29kZV1dXCJ9PC9fY29tcG9uZW50cy5jb2RlPntcIiBpblxcbmFuIGlubGluZSBjb2RlIHNwYW4gc3RheXMgbGl0ZXJhbC5cIn08L19jb21wb25lbnRzLnA+PC8+O1xufVxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTURYQ29udGVudChwcm9wcyA9IHt9KSB7XG4gIGNvbnN0IHt3cmFwcGVyOiBNRFhMYXlvdXR9ID0ge1xuICAgIC4uLl9wcm92aWRlQ29tcG9uZW50cygpLFxuICAgIC4uLnByb3BzLmNvbXBvbmVudHNcbiAgfTtcbiAgcmV0dXJuIE1EWExheW91dCA/IDxNRFhMYXlvdXQgey4uLnByb3BzfT48X2NyZWF0ZU1keENvbnRlbnQgey4uLnByb3BzfSAvPjwvTURYTGF5b3V0PiA6IF9jcmVhdGVNZHhDb250ZW50KHByb3BzKTtcbn1cbmZ1bmN0aW9uIF9taXNzaW5nTWR4UmVmZXJlbmNlKGlkLCBjb21wb25lbnQsIHBsYWNlKSB7XG4gIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIFwiICsgKGNvbXBvbmVudCA/IFwiY29tcG9uZW50XCIgOiBcIm9iamVjdFwiKSArIFwiIGBcIiArIGlkICsgXCJgIHRvIGJlIGRlZmluZWQ6IHlvdSBsaWtlbHkgZm9yZ290IHRvIGltcG9ydCwgcGFzcywgb3IgcHJvdmlkZSBpdC5cIiArIChwbGFjZSA/IFwiXFxuSXTigJlzIHJlZmVyZW5jZWQgaW4geW91ciBjb2RlIGF0IGBcIiArIHBsYWNlICsgXCJgIGluIGAvYXBwL2NvbnRlbnQvd2lraWxpbmsubWR4YFwiIDogXCJcIikpO1xufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBRUE7QUFBd0Y7QUFGeEY7QUFDQTs7QUFFQSxTQUFTLGlCQUFpQixDQUFDLEtBQUssRUFBRTtFQUNoQyxNQUFNLFdBQVcsR0FBRztNQUNsQixDQUFDLEVBQUUsR0FBRztNQUNOLElBQUksRUFBRSxNQUFNO01BQ1osRUFBRSxFQUFFLElBQUk7TUFDUixDQUFDLEVBQUUsR0FBRztNQUNOLE1BQU0sRUFBRSxRQUFRO01BQ2hCLEtBQUssRUFBRSxPQUFPO01BQ2QsS0FBSyxFQUFFLE9BQU87TUFDZCxFQUFFLEVBQUUsSUFBSTtNQUNSLEVBQUUsRUFBRSxJQUFJO01BQ1IsS0FBSyxFQUFFLE9BQU87TUFDZCxFQUFFLEVBQUUsSUFBSTtNQUNSLEdBQUcsSUFBQUEsNkJBQWtCLEVBQUMsQ0FBQztNQUN2QixHQUFHLEtBQUssQ0FBQztJQUNYLENBQUM7SUFBRTtNQUFDLGFBQWE7TUFBRTtJQUFRLENBQUMsR0FBRyxXQUFXO0VBQzFDLElBQUksQ0FBQyxhQUFhLEVBQUUsb0JBQW9CLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQztFQUMvRCxJQUFJLENBQUMsUUFBUSxFQUFFLG9CQUFvQixDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUM7RUFDckQsb0JBQU87SUFBQSx3QkFBRSxzQkFBQyxXQUFXLENBQUMsRUFBRTtNQUFDLEVBQUUsRUFBQyxXQUFXO01BQUEsd0JBQUMscUJBQUMsYUFBYTtRQUFDLEVBQUUsRUFBQztNQUFXLENBQUUsQ0FBQyxFQUFDLFdBQVc7SUFBQSxDQUFpQixDQUFDLEVBQUMsSUFBSSxlQUFDLHNCQUFDLFdBQVcsQ0FBQyxDQUFDO01BQUEsV0FBRSx1QkFBdUIs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