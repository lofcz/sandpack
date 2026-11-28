# Node module caching

Immutable, exact-versioned module requests (the module CDN's `/package/...`
endpoints and unpkg files) are cached at runtime in a persistent Cache API
cache — see `registerImmutableUrlPrefix` in `src/utils/fetch.ts`. The first
fetch of a given URL populates the cache; later loads are served from it
without touching the network. There is nothing to regenerate or check in.

# Sandpack Bundler

The sandpack bundler, this aims to eventually replace the current sandpack with a more streamlined and faster version.

## Getting started

The package is part of the bun workspace: run `bun install` once at the repository root.

| Command | What it does |
| --- | --- |
| `npm run dev` | Rsbuild dev server on `http://localhost:1234/`. Set the `bundlerURL` of the sandpack client to it. |
| `npm run build` | Production build into `dist/` (regenerates the SDK protocol version and the toolchain hash first). |
| `npm start` | Serves the built `dist/` on `http://localhost:4587/` (`rsbuild preview`). |
| `npm test` | The test suite on Rstest. |
| `npm run typecheck` | TypeScript, no emit. |
| `npm run lint` | Rslint. |
| `npm run format` | Prettier over `src`. |

`dist/` is what a host serves: `index.html` at its root, every other file next to it under a
content-hashed name and referenced by a relative URL, source maps as separate `.map` files.
The page is meant to run in a sandboxed iframe without `allow-same-origin`; all its scripts are
ES modules, so the host must answer them with `Access-Control-Allow-Origin`.

To see what the bundle is made of, build with Rsdoctor: `RSDOCTOR=true npx rsbuild build`
(it writes its report into `dist/`, so build again without it before shipping).

## Using the deployed version

The `main` branch of this repository is automatically deployed to `https://sandpack-bundler.codesandbox.io` so you can update `bundlerURL` of `sandpack-react` to that url and start using the new sandpack bundler.

## Fonts

```
cp -r /Users/neumark/git/sandpack-test/my-app/node_modules/@fontsource/roboto/files ./dist/
```
