# React CDN integration fixtures

Unmodified MessagePack responses from the deployed protocol-6 CDN, compressed
with gzip for storage. Captured from `https://app.sciobot.cz/sandpack-cdn/package/`
using `base64("6(" + name + "@" + version + ")")` on 2026-11-04:

- `react@19.1.0`
- `react-dom@19.1.0`
- `scheduler@0.26.0`

The rendering regression runs the real development renderer and a state-changing
click through the bundler's compile/evaluate path, without a network dependency.
It catches missing CommonJS links that compile-only tests with empty package
stubs cannot detect. The original sources are MIT-licensed; see `LICENSE`.
