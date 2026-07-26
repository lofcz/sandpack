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
      blockquote: "blockquote",
      h1: "h1",
      p: "p",
      strong: "strong",
      ...(0, _MDXProvider.useMDXComponents)(),
      ...props.components
    },
    {
      Admonition,
      HeadingAnchor
    } = _components;
  if (!Admonition) _missingMdxReference("Admonition", true);
  if (!HeadingAnchor) _missingMdxReference("HeadingAnchor", true);
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
    children: [/*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.h1, {
      id: "admonitions",
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(HeadingAnchor, {
        id: "admonitions"
      }), "Admonitions"]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(Admonition, {
      type: "note",
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.p, {
        children: "Useful information the reader should know."
      })
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(Admonition, {
      type: "tip",
      children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.p, {
        children: ["A helpful tip with a ", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.a, {
          href: "https://example.com",
          children: "link"
        }), " and ", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.strong, {
          children: "bold"
        }), "."]
      })
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(Admonition, {
      type: "important",
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.p, {
        children: "Key information."
      })
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(Admonition, {
      type: "warning",
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.p, {
        children: "Something that could cause a problem."
      })
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(Admonition, {
      type: "caution",
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.p, {
        children: "Negative consequences of an action."
      })
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(Admonition, {
      type: "note"
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.blockquote, {
      children: ["\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.p, {
        children: "An ordinary blockquote is left untouched.\nSecond line of the quote."
      }), "\n"]
    }), "\n", /*#__PURE__*/(0, _jsxRuntime.jsxs)(_components.blockquote, {
      children: ["\n", /*#__PURE__*/(0, _jsxRuntime.jsx)(_components.p, {
        children: "[!NOTE] this marker is not alone on its line, so it stays a quote."
      }), "\n"]
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
  throw new Error("Expected " + (component ? "component" : "object") + " `" + id + "` to be defined: you likely forgot to import, pass, or provide it." + (place ? "\nIt’s referenced in your code at `" + place + "` in `/app/content/admonition.mdx`" : ""));
}
var _c;
$RefreshReg$(_c, "MDXContent");

_csbRefreshUtils.postlude(module);
window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfTURYUHJvdmlkZXIiLCJyZXF1aXJlIiwiX2pzeFJ1bnRpbWUiLCJfY3JlYXRlTWR4Q29udGVudCIsInByb3BzIiwiX2NvbXBvbmVudHMiLCJhIiwiYmxvY2txdW90ZSIsImgxIiwicCIsInN0cm9uZyIsIl9wcm92aWRlQ29tcG9uZW50cyIsImNvbXBvbmVudHMiLCJBZG1vbml0aW9uIiwiSGVhZGluZ0FuY2hvciIsIl9taXNzaW5nTWR4UmVmZXJlbmNlIiwianN4cyIsIkZyYWdtZW50IiwiY2hpbGRyZW4iLCJpZCIsImpzeCIsInR5cGUiLCJocmVmIiwiTURYQ29udGVudCIsIndyYXBwZXIiLCJNRFhMYXlvdXQiLCJfYyIsImNvbXBvbmVudCIsInBsYWNlIiwiRXJyb3IiLCIkUmVmcmVzaFJlZyQiXSwic291cmNlcyI6WyJhZG1vbml0aW9uLm1keCJdLCJzb3VyY2VzQ29udGVudCI6WyIvKkBqc3hSdW50aW1lIGF1dG9tYXRpYyovXG4vKkBqc3hJbXBvcnRTb3VyY2UgcmVhY3QqL1xuaW1wb3J0IHt1c2VNRFhDb21wb25lbnRzIGFzIF9wcm92aWRlQ29tcG9uZW50c30gZnJvbSBcIkBpbW1lZGlhdGVseS1ydW4vc2RrL01EWFByb3ZpZGVyXCI7XG5mdW5jdGlvbiBfY3JlYXRlTWR4Q29udGVudChwcm9wcykge1xuICBjb25zdCBfY29tcG9uZW50cyA9IHtcbiAgICBhOiBcImFcIixcbiAgICBibG9ja3F1b3RlOiBcImJsb2NrcXVvdGVcIixcbiAgICBoMTogXCJoMVwiLFxuICAgIHA6IFwicFwiLFxuICAgIHN0cm9uZzogXCJzdHJvbmdcIixcbiAgICAuLi5fcHJvdmlkZUNvbXBvbmVudHMoKSxcbiAgICAuLi5wcm9wcy5jb21wb25lbnRzXG4gIH0sIHtBZG1vbml0aW9uLCBIZWFkaW5nQW5jaG9yfSA9IF9jb21wb25lbnRzO1xuICBpZiAoIUFkbW9uaXRpb24pIF9taXNzaW5nTWR4UmVmZXJlbmNlKFwiQWRtb25pdGlvblwiLCB0cnVlKTtcbiAgaWYgKCFIZWFkaW5nQW5jaG9yKSBfbWlzc2luZ01keFJlZmVyZW5jZShcIkhlYWRpbmdBbmNob3JcIiwgdHJ1ZSk7XG4gIHJldHVybiA8PjxfY29tcG9uZW50cy5oMSBpZD1cImFkbW9uaXRpb25zXCI+PEhlYWRpbmdBbmNob3IgaWQ9XCJhZG1vbml0aW9uc1wiIC8+e1wiQWRtb25pdGlvbnNcIn08L19jb21wb25lbnRzLmgxPntcIlxcblwifTxBZG1vbml0aW9uIHR5cGU9XCJub3RlXCI+PF9jb21wb25lbnRzLnA+e1wiVXNlZnVsIGluZm9ybWF0aW9uIHRoZSByZWFkZXIgc2hvdWxkIGtub3cuXCJ9PC9fY29tcG9uZW50cy5wPjwvQWRtb25pdGlvbj57XCJcXG5cIn08QWRtb25pdGlvbiB0eXBlPVwidGlwXCI+PF9jb21wb25lbnRzLnA+e1wiQSBoZWxwZnVsIHRpcCB3aXRoIGEgXCJ9PF9jb21wb25lbnRzLmEgaHJlZj1cImh0dHBzOi8vZXhhbXBsZS5jb21cIj57XCJsaW5rXCJ9PC9fY29tcG9uZW50cy5hPntcIiBhbmQgXCJ9PF9jb21wb25lbnRzLnN0cm9uZz57XCJib2xkXCJ9PC9fY29tcG9uZW50cy5zdHJvbmc+e1wiLlwifTwvX2NvbXBvbmVudHMucD48L0FkbW9uaXRpb24+e1wiXFxuXCJ9PEFkbW9uaXRpb24gdHlwZT1cImltcG9ydGFudFwiPjxfY29tcG9uZW50cy5wPntcIktleSBpbmZvcm1hdGlvbi5cIn08L19jb21wb25lbnRzLnA+PC9BZG1vbml0aW9uPntcIlxcblwifTxBZG1vbml0aW9uIHR5cGU9XCJ3YXJuaW5nXCI+PF9jb21wb25lbnRzLnA+e1wiU29tZXRoaW5nIHRoYXQgY291bGQgY2F1c2UgYSBwcm9ibGVtLlwifTwvX2NvbXBvbmVudHMucD48L0FkbW9uaXRpb24+e1wiXFxuXCJ9PEFkbW9uaXRpb24gdHlwZT1cImNhdXRpb25cIj48X2NvbXBvbmVudHMucD57XCJOZWdhdGl2ZSBjb25zZXF1ZW5jZXMgb2YgYW4gYWN0aW9uLlwifTwvX2NvbXBvbmVudHMucD48L0FkbW9uaXRpb24+e1wiXFxuXCJ9PEFkbW9uaXRpb24gdHlwZT1cIm5vdGVcIiAvPntcIlxcblwifTxfY29tcG9uZW50cy5ibG9ja3F1b3RlPntcIlxcblwifTxfY29tcG9uZW50cy5wPntcIkFuIG9yZGluYXJ5IGJsb2NrcXVvdGUgaXMgbGVmdCB1bnRvdWNoZWQuXFxuU2Vjb25kIGxpbmUgb2YgdGhlIHF1b3RlLlwifTwvX2NvbXBvbmVudHMucD57XCJcXG5cIn08L19jb21wb25lbnRzLmJsb2NrcXVvdGU+e1wiXFxuXCJ9PF9jb21wb25lbnRzLmJsb2NrcXVvdGU+e1wiXFxuXCJ9PF9jb21wb25lbnRzLnA+e1wiWyFOT1RFXSB0aGlzIG1hcmtlciBpcyBub3QgYWxvbmUgb24gaXRzIGxpbmUsIHNvIGl0IHN0YXlzIGEgcXVvdGUuXCJ9PC9fY29tcG9uZW50cy5wPntcIlxcblwifTwvX2NvbXBvbmVudHMuYmxvY2txdW90ZT48Lz47XG59XG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBNRFhDb250ZW50KHByb3BzID0ge30pIHtcbiAgY29uc3Qge3dyYXBwZXI6IE1EWExheW91dH0gPSB7XG4gICAgLi4uX3Byb3ZpZGVDb21wb25lbnRzKCksXG4gICAgLi4ucHJvcHMuY29tcG9uZW50c1xuICB9O1xuICByZXR1cm4gTURYTGF5b3V0ID8gPE1EWExheW91dCB7Li4ucHJvcHN9PjxfY3JlYXRlTWR4Q29udGVudCB7Li4ucHJvcHN9IC8+PC9NRFhMYXlvdXQ+IDogX2NyZWF0ZU1keENvbnRlbnQocHJvcHMpO1xufVxuZnVuY3Rpb24gX21pc3NpbmdNZHhSZWZlcmVuY2UoaWQsIGNvbXBvbmVudCwgcGxhY2UpIHtcbiAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgXCIgKyAoY29tcG9uZW50ID8gXCJjb21wb25lbnRcIiA6IFwib2JqZWN0XCIpICsgXCIgYFwiICsgaWQgKyBcImAgdG8gYmUgZGVmaW5lZDogeW91IGxpa2VseSBmb3Jnb3QgdG8gaW1wb3J0LCBwYXNzLCBvciBwcm92aWRlIGl0LlwiICsgKHBsYWNlID8gXCJcXG5JdOKAmXMgcmVmZXJlbmNlZCBpbiB5b3VyIGNvZGUgYXQgYFwiICsgcGxhY2UgKyBcImAgaW4gYC9hcHAvY29udGVudC9hZG1vbml0aW9uLm1keGBcIiA6IFwiXCIpKTtcbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBRUEsSUFBQUEsWUFBQSxHQUFBQyxPQUFBO0FBQXdGLElBQUFDLFdBQUEsR0FBQUQsT0FBQTtBQUZ4RjtBQUNBOztBQUVBLFNBQVNFLGlCQUFpQkEsQ0FBQ0MsS0FBSyxFQUFFO0VBQ2hDLE1BQU1DLFdBQVcsR0FBRztNQUNsQkMsQ0FBQyxFQUFFLEdBQUc7TUFDTkMsVUFBVSxFQUFFLFlBQVk7TUFDeEJDLEVBQUUsRUFBRSxJQUFJO01BQ1JDLENBQUMsRUFBRSxHQUFHO01BQ05DLE1BQU0sRUFBRSxRQUFRO01BQ2hCLEdBQUcsSUFBQUMsNkJBQWtCLEVBQUMsQ0FBQztNQUN2QixHQUFHUCxLQUFLLENBQUNRO0lBQ1gsQ0FBQztJQUFFO01BQUNDLFVBQVU7TUFBRUM7SUFBYSxDQUFDLEdBQUdULFdBQVc7RUFDNUMsSUFBSSxDQUFDUSxVQUFVLEVBQUVFLG9CQUFvQixDQUFDLFlBQVksRUFBRSxJQUFJLENBQUM7RUFDekQsSUFBSSxDQUFDRCxhQUFhLEVBQUVDLG9CQUFvQixDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUM7RUFDL0Qsb0JBQU8sSUFBQWIsV0FBQSxDQUFBYyxJQUFBLEVBQUFkLFdBQUEsQ0FBQWUsUUFBQTtJQUFBQyxRQUFBLGdCQUFFLElBQUFoQixXQUFBLENBQUFjLElBQUEsRUFBQ1gsV0FBVyxDQUFDRyxFQUFFO01BQUNXLEVBQUUsRUFBQyxhQUFhO01BQUFELFFBQUEsZ0JBQUMsSUFBQWhCLFdBQUEsQ0FBQWtCLEdBQUEsRUFBQ04sYUFBYTtRQUFDSyxFQUFFLEVBQUM7TUFBYSxDQUFFLENBQUMsRUFBQyxhQUFhO0lBQUEsQ0FBaUIsQ0FBQyxFQUFDLElBQUksZUFBQyxJQUFBakIsV0FBQSxDQUFBa0IsR0FBQSxFQUFDUCxVQUFVO01BQUNRLElB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