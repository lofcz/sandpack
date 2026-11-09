<img style="width:100%" src="https://user-images.githubusercontent.com/4838076/143581035-ebee5ba2-9cb1-4fe8-a05b-2f44bd69bb4b.gif" alt="Component toolkit for live running code editing experiences" />

# Sandpack client 

This is a small foundation package that sits on top of the bundler. It is
framework agnostic and facilitates the handshake between your context and the bundler iframe.

The fork also ships its matching preview runtime in `sandpack/`. Resolve
`@lofcz/sandpack-client/sandpack/index.html` from your build, copy that directory
to a versioned static path, and pass its absolute URL as `bundlerURL`. Serve all
runtime assets with `Access-Control-Allow-Origin: *` because the preview has an
opaque sandbox origin. Keep `allow-same-origin` disabled, and serve the runtime
document with a sandbox response policy too. Set `sandpackCdnRoot` separately;
the package resolver need not share the static runtime's host. The Babel worker
continues to ship in `@lofcz/transpiler/worker/`.

```js
import { loadSandpackClient } from "@codesandbox/sandpack-client";

const main = async () => {
  const client = await loadSandpackClient("#preview", {
    files: {
      "/index.js": {
        code: `console.log(require('uuid'))`,
      },
    },
    entry: "/index.js",
    dependencies: {
      uuid: "latest",
    },
  });
}
```

[Read more](https://sandpack.codesandbox.io/docs/advanced-usage/client)
