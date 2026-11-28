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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcHJvdmlkZUNvbXBvbmVudHMiXSwic291cmNlcyI6WyJwb3N0Lm1keCJdLCJzb3VyY2VzQ29udGVudCI6WyIvKkBqc3hSdW50aW1lIGF1dG9tYXRpYyovXG4vKkBqc3hJbXBvcnRTb3VyY2UgcmVhY3QqL1xuaW1wb3J0IHt1c2VNRFhDb21wb25lbnRzIGFzIF9wcm92aWRlQ29tcG9uZW50c30gZnJvbSBcIkBpbW1lZGlhdGVseS1ydW4vc2RrL01EWFByb3ZpZGVyXCI7XG5mdW5jdGlvbiBfY3JlYXRlTWR4Q29udGVudChwcm9wcykge1xuICBjb25zdCBfY29tcG9uZW50cyA9IHtcbiAgICBhOiBcImFcIixcbiAgICBkZWw6IFwiZGVsXCIsXG4gICAgaDE6IFwiaDFcIixcbiAgICBwOiBcInBcIixcbiAgICBzdHJvbmc6IFwic3Ryb25nXCIsXG4gICAgdGFibGU6IFwidGFibGVcIixcbiAgICB0Ym9keTogXCJ0Ym9keVwiLFxuICAgIHRkOiBcInRkXCIsXG4gICAgdGg6IFwidGhcIixcbiAgICB0aGVhZDogXCJ0aGVhZFwiLFxuICAgIHRyOiBcInRyXCIsXG4gICAgLi4uX3Byb3ZpZGVDb21wb25lbnRzKCksXG4gICAgLi4ucHJvcHMuY29tcG9uZW50c1xuICB9LCB7Q2FsbG91dCwgSGVhZGluZ0FuY2hvcn0gPSBfY29tcG9uZW50cztcbiAgaWYgKCFDYWxsb3V0KSBfbWlzc2luZ01keFJlZmVyZW5jZShcIkNhbGxvdXRcIiwgdHJ1ZSwgXCI2OjEtNjo1MFwiKTtcbiAgaWYgKCFIZWFkaW5nQW5jaG9yKSBfbWlzc2luZ01keFJlZmVyZW5jZShcIkhlYWRpbmdBbmNob3JcIiwgdHJ1ZSk7XG4gIHJldHVybiA8PjxfY29tcG9uZW50cy5oMSBpZD1cInNlY3Rpb25cIj48SGVhZGluZ0FuY2hvciBpZD1cInNlY3Rpb25cIiAvPntwcm9wcy50aXRsZSA/PyAnSGVsbG8nfTwvX2NvbXBvbmVudHMuaDE+e1wiXFxuXCJ9PF9jb21wb25lbnRzLnA+e1wiVGhpcyBpcyBcIn08X2NvbXBvbmVudHMuc3Ryb25nPntcIk1EWFwifTwvX2NvbXBvbmVudHMuc3Ryb25nPntcIiB3aXRoIGEgXCJ9PF9jb21wb25lbnRzLmEgaHJlZj1cImh0dHBzOi8vZXhhbXBsZS5jb21cIj57XCJsaW5rXCJ9PC9fY29tcG9uZW50cy5hPntcIiBhbmQgR0ZNIFwifTxfY29tcG9uZW50cy5kZWw+e1wic3RyaWtldGhyb3VnaFwifTwvX2NvbXBvbmVudHMuZGVsPntcIi5cIn08L19jb21wb25lbnRzLnA+e1wiXFxuXCJ9PENhbGxvdXQ+e1wiUmVuZGVyZWQgdGhyb3VnaCB0aGUgcHJvdmlkZXIuXCJ9PC9DYWxsb3V0PntcIlxcblwifTxfY29tcG9uZW50cy50YWJsZT48X2NvbXBvbmVudHMudGhlYWQ+PF9jb21wb25lbnRzLnRyPjxfY29tcG9uZW50cy50aD57XCJhXCJ9PC9fY29tcG9uZW50cy50aD48X2NvbXBvbmVudHMudGg+e1wiYlwifTwvX2NvbXBvbmVudHMudGg+PC9fY29tcG9uZW50cy50cj48L19jb21wb25lbnRzLnRoZWFkPjxfY29tcG9uZW50cy50Ym9keT48X2NvbXBvbmVudHMudHI+PF9jb21wb25lbnRzLnRkPntcIjFcIn08L19jb21wb25lbnRzLnRkPjxfY29tcG9uZW50cy50ZD57XCIyXCJ9PC9fY29tcG9uZW50cy50ZD48L19jb21wb25lbnRzLnRyPjwvX2NvbXBvbmVudHMudGJvZHk+PC9fY29tcG9uZW50cy50YWJsZT48Lz47XG59XG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBNRFhDb250ZW50KHByb3BzID0ge30pIHtcbiAgY29uc3Qge3dyYXBwZXI6IE1EWExheW91dH0gPSB7XG4gICAgLi4uX3Byb3ZpZGVDb21wb25lbnRzKCksXG4gICAgLi4ucHJvcHMuY29tcG9uZW50c1xuICB9O1xuICByZXR1cm4gTURYTGF5b3V0ID8gPE1EWExheW91dCB7Li4ucHJvcHN9PjxfY3JlYXRlTWR4Q29udGVudCB7Li4ucHJvcHN9IC8+PC9NRFhMYXlvdXQ+IDogX2NyZWF0ZU1keENvbnRlbnQocHJvcHMpO1xufVxuZnVuY3Rpb24gX21pc3NpbmdNZHhSZWZlcmVuY2UoaWQsIGNvbXBvbmVudCwgcGxhY2UpIHtcbiAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgXCIgKyAoY29tcG9uZW50ID8gXCJjb21wb25lbnRcIiA6IFwib2JqZWN0XCIpICsgXCIgYFwiICsgaWQgKyBcImAgdG8gYmUgZGVmaW5lZDogeW91IGxpa2VseSBmb3Jnb3QgdG8gaW1wb3J0LCBwYXNzLCBvciBwcm92aWRlIGl0LlwiICsgKHBsYWNlID8gXCJcXG5JdOKAmXMgcmVmZXJlbmNlZCBpbiB5b3VyIGNvZGUgYXQgYFwiICsgcGxhY2UgKyBcImAgaW4gYC9hcHAvY29udGVudC9wb3N0Lm1keGBcIiA6IFwiXCIpKTtcbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUVBO0FBQXdGO0FBRnhGO0FBQ0E7O0FBRUEsU0FBUyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUU7RUFDaEMsTUFBTSxXQUFXLEdBQUc7TUFDbEIsQ0FBQyxFQUFFLEdBQUc7TUFDTixHQUFHLEVBQUUsS0FBSztNQUNWLEVBQUUsRUFBRSxJQUFJO01BQ1IsQ0FBQyxFQUFFLEdBQUc7TUFDTixNQUFNLEVBQUUsUUFBUTtNQUNoQixLQUFLLEVBQUUsT0FBTztNQUNkLEtBQUssRUFBRSxPQUFPO01BQ2QsRUFBRSxFQUFFLElBQUk7TUFDUixFQUFFLEVBQUUsSUFBSTtNQUNSLEtBQUssRUFBRSxPQUFPO01BQ2QsRUFBRSxFQUFFLElBQUk7TUFDUixHQUFHLElBQUFBLDZCQUFrQixFQUFDLENBQUM7TUFDdkIsR0FBRyxLQUFLLENBQUM7SUFDWCxDQUFDO0lBQUU7TUFBQyxPQUFPO01BQUU7SUFBYSxDQUFDLEdBQUcsV0FBVztFQUN6QyxJQUFJLENBQUMsT0FBTyxFQUFFLG9CQUFvQixDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsVUFBVSxDQUFDO0VBQy9ELElBQUksQ0FBQyxhQUFhLEVBQUUsb0JBQW9CLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQztFQUMvRCxvQkFBTztJQUFBLHdCQUFFLHNCQUFDLFdBQVcsQ0FBQyxFQUFFO01BQUMsRUFBRSxFQUFDLFNBQVM7TUFBQSx3QkFBQyxxQkFBQyxhQUFhO1FBQUMsRUFBRSxFQUFDO01BQVMsQ0FBRSxDQUFDLEVBQUMsS0FBSyxDQUFDLEtBQUssSUFBSSxPQUFPO0lBQUEsQ0FBaUIsQ0FBQyxFQUFDLElBQUksZUFBQyxzQkFBQyxXQUFXLENBQUMsQ0FBQztNQUFBLFdBQUUsVUFBVSxlQUFDLHFCQUFDLFdBQVcsQ0FBQyxNQUFNO1FBQUEsVUFBRTtNQUFLLENBQXFCLENBQUMsRUFBQyxVQUFVLGVBQUMscUJBQUMsV0FBVyxDQUFDLENBQUM7UUFBQyxJQUFJLEVBQUMscUJBQXFCO1FBQUEsVUFBRTtNQUFNLENBQWdCLENBQUMsRUFBQyxXQUFXLGVBQUMscUJBQUMsV0FBVyxDQUFDLEdBQUc7UUFBQSxVQUFFO01BQWUsQ0FBa0IsQ0FBQyxFQUFDLEdBQUc7SUFBQSxDQUFnQixDQUFDLEVBQUMsSUFBSSxlQUFDLHFCQUFDLE9BQU87TUFBQSxVQUFFO0lBQWdDLENBQVUsQ0FBQyxFQUFDLElBQUksZUFBQyxzQkFBQyxXQUFXLENBQUMsS0FBSztNQUFBLHdCQUFDLHFCQUFDLFdBQVcsQ0FBQyxLQUFLO1FBQUEsdUJBQUMsc0JBQUMsV0FBVyxDQUFDLEVBQUU7VUFBQSx3QkFBQyxxQkFBQyxXQUFXLENBQUMsRUFBRTtZQUFBLFVBQUU7VUFBRyxDQUFpQixDQUFDLG9DQUFDLFdBQVcsQ0FBQyxFQUFFO1lBQUEsVUFBRTtVQUFHLENBQWlCLENBQUM7UUFBQSxDQUFnQjtNQUFDLENBQW1CLENBQUMsb0NBQUMsV0FBVyxDQUFDLEtBQUs7UUFBQSx1QkFBQyxzQkFBQyxXQUFXLENBQUMsRUFBRTtVQUFBLHdCQUFDLHFCQUFDLFdBQVcsQ0FBQyxFQUFFO1lBQUEsVUFBRTtVQUFHLENBQWlCLENBQUMsb0NBQUMsV0FBVyxDQUFDLEVBQUU7WUFBQSxVQUFFO1VBQUcsQ0FBaUIsQ0FBQztRQUFBLENBQWdCO01BQUMsQ0FBbUIsQ0FBQztJQUFBLENBQW1CLENBQUM7RUFBQSxDQUFFLENBQUM7QUFDdnZCO0FBQ2UsU0FBUyxVQUFVLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxFQUFFO0VBQzdDLE1BQU07SUFBQyxPQUFPLEVBQUU7RUFBUyxDQUFDLEdBQUc7SUFDM0IsR0FBRyxJQUFBQSw2QkFBa0IsRUFBQyxDQUFDO0lBQ3ZCLEdBQUcsS0FBSyxDQUFDO0VBQ1gsQ0FBQztFQUNELE9BQU8sU0FBUyxnQkFBRyxxQkFBQyxTQUFTO0lBQUEsR0FBSyxLQUFLO0lBQUEsdUJBQUUscUJBQUMsaUJBQWlCO01BQUEsR0FBSztJQUFLLENBQUc7RUFBQyxDQUFXLENBQUMsR0FBRyxpQkFBaUIsQ0FBQyxLQUFLLENBQUM7QUFDbEg7QUFBQyxLQU51QixVQUFVO0FBT2xDLFNBQVMsb0JBQW9CLENBQUMsRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUU7RUFDbEQsTUFBTSxJQUFJLEtBQUssQ0FBQyxXQUFXLElBQUksU0FBUyxHQUFHLFdBQVcsR0FBRyxRQUFRLENBQUMsR0FBRyxJQUFJLEdBQUcsRUFBRSxHQUFHLG9FQUFvRSxJQUFJLEtBQUssR0FBRyxxQ0FBcUMsR0FBRyxLQUFLLEdBQUcsOEJBQThCLEdBQUcsRUFBRSxDQUFDLENBQUM7QUFDeFA7QUFBQztBQUFBIiwiaWdub3JlTGlzdCI6W119