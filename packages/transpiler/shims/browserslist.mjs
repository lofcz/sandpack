// `@babel/helper-compilation-targets` imports browserslist to turn a browser
// query into targets. The core-js plugin never asks it to: the chain sets the
// query once, at the top level, and the standalone engine (which carries its
// own browserslist and browser data) resolves it for every plugin. A second
// copy of that data would only be dead weight, and a second answer to the same
// query would be worse.
export default function browserslist() {
  throw new Error('Browser queries are resolved by @babel/standalone: set `targets` at the top level of the Babel options.');
}
