<img style="width:100%" src="https://user-images.githubusercontent.com/4838076/143581035-ebee5ba2-9cb1-4fe8-a05b-2f44bd69bb4b.gif" alt="Component toolkit for live running code editing experiences" />

# Sandpack React

React components that give you the power of editable sandboxes that run in the browser.

```jsx
import { Sandpack } from "@codesandbox/sandpack-react";

<Sandpack template="react" />;
```

[Read more](https://sandpack.codesandbox.io/)

## Documentation

For full documentation, visit [https://sandpack.codesandbox.io/docs/](https://sandpack.codesandbox.io/docs/)

## Migration: from `files` map to `SandpackFS`

Sandpack now stores file content inside a ZenFS-backed filesystem
(`SandpackFS`) instead of a synchronous `Record<string, string>` map. Most of
the existing APIs still accept the familiar `files` prop and materialize it
for you, but a few things changed that you should know about:

- **`sandpack.files` is gone.** Use `sandpack.fileList` (ordered array of
  paths), `sandpack.fileMeta` (per-file `hidden` / `active` / `readOnly`), and
  `sandpack.fs` (a `SandpackFS` instance) to read content:

  ```ts
  const { sandpack } = useSandpack();
  const code = await sandpack.fs.readFile(sandpack.activeFile);
  ```

- **File mutations are asynchronous.** `updateFile`, `addFile`,
  `deleteFile`, `resetFile`, `resetAllFiles`, and `updateCurrentFile` all
  return `Promise<void>` now. `useActiveCode` exposes an `isLoading` flag for
  the initial read.

- **`options.fileResolver` was removed.** Hand Sandpack a fully-formed
  filesystem via the new `fs` prop on `SandpackProvider` (or seed it via
  `files`) instead of providing a resolver callback.

- **`SandpackBundlerFiles` is deprecated.** It remains exported as a type
  alias for the `{code, ...meta}` snapshot shape that the bundler iframe
  protocol still consumes, but new code should use `SandpackFilesInput` (the
  input to `SandpackFS.fromFiles`) or operate on `SandpackFS` directly.

You can also pass a pre-built `SandpackFS` to `SandpackProvider`:

```tsx
import { SandpackFS } from "@lofcz/sandpack-client";

const fs = await SandpackFS.fromFiles({
  "/index.js": { code: "console.log('hi')" },
});

<SandpackProvider fs={fs}>{/* ... */}</SandpackProvider>;
```

