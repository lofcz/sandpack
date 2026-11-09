import { Module } from '../../module/Module';
import { ReactPreset } from '../../presets/react/ReactPreset';
import { RawCjsTransformer } from './index';
import { isPassthroughCjs, scanCjsModule } from './scan';

// Regression guard for the ZenFS-flip slowdown: dependencies resolved from the
// Sandpack CDN / unpkg must NOT be run through Babel. The CDN only returns each
// package's dependency graph; published packages are browser-ready CJS. Babel
// (preset-env `useBuiltIns:'usage'`) is reserved for app source — running it on
// every dependency injected core-js into and lowered react-dom/scheduler/etc.,
// the multi-second first-load tax these tests lock down.

/** Minimal Module stand-in: mapTransformers only reads filepath + source. */
const mod = (filepath: string, source = ''): Module => ({ filepath, source } as Module);

describe('scanCjsModule', () => {
  it('collects require(<literal>) specifiers, de-duplicated in first-seen order', () => {
    const src = `var a=require("react"),b=require('scheduler');require("react");require(\`tpl\`);`;
    expect(scanCjsModule(src).requires).toEqual(['react', 'scheduler']);
  });

  it('ignores member-access .require() and require inside strings/comments', () => {
    const src = `obj.require("nope"); // require("comment")\n/* require("block") */ var s="require('str')";`;
    expect(scanCjsModule(src).requires).toEqual([]);
  });

  it('does not flag CommonJS as ESM', () => {
    const src = `"use strict";var x=require("react");module.exports=x;`;
    expect(scanCjsModule(src).isEsm).toBe(false);
  });

  it('flags real ESM import/export statements (incl. minified, no spaces)', () => {
    expect(scanCjsModule(`import x from "y";`).isEsm).toBe(true);
    expect(scanCjsModule(`import{a}from"y";`).isEsm).toBe(true);
    expect(scanCjsModule(`export default 1;`).isEsm).toBe(true);
    expect(scanCjsModule(`export*from"y";`).isEsm).toBe(true);
  });

  it('transforms dynamic import and import.meta for the sandbox runtime', () => {
    expect(scanCjsModule(`const m = import("y");`).isEsm).toBe(true);
    expect(scanCjsModule(`const u = import.meta.url;`).isEsm).toBe(true);
  });

  it('collects decoded specifiers inside nested template expressions', () => {
    const source = 'module.exports = `outer ${`inner ${require("re\\x61ct")}`} ${require("scheduler")}`;';
    expect(scanCjsModule(source)).toEqual({ requires: ['react', 'scheduler'], isEsm: false });
  });

  it('distinguishes property names and control-flow regex literals from imports', () => {
    expect(scanCjsModule('if (ok) /require("fake")/.test(s); const x = { export: 1, import: 2 }; require("real");'))
      .toEqual({ requires: ['real'], isEsm: false });
  });

  it('routes unsupported syntax to the compiler instead of executing it raw', () => {
    expect(scanCjsModule('const x: number = 1; module.exports = x;').isEsm).toBe(true);
    expect(scanCjsModule('module.exports = <div />;').isEsm).toBe(true);
  });

  it('defers locally bound require and computed specifiers to the scope-aware compiler', () => {
    expect(scanCjsModule('function loader(require) { return require("not-an-npm-package"); }').isEsm).toBe(true);
    expect(scanCjsModule('function loader({ require }) { return require("local"); }').isEsm).toBe(true);
    expect(scanCjsModule('const name = "react"; module.exports = require(name);').isEsm).toBe(true);
    expect(scanCjsModule('module.exports = require("react" + "-dom");').isEsm).toBe(true);
    expect(scanCjsModule('module.exports = require("react", true);').requires).toEqual(['react']);
  });

  // R3-233: a regex literal whose body holds a quote or `/` used to desync the
  // string scanner and hide the real `export` after it (the SDK's `scrollToId.js`
  // `id.replace(/["\\]/g, "\\$&")` → misclassified CJS → served raw ESM → boot crash).
  it('skips regex literals so a trailing export is still seen (R3-233)', () => {
    expect(scanCjsModule(`const e = s.replace(/["\\\\]/g, "_");\nexport { e };`).isEsm).toBe(true);
    // the exact SDK scrollToId.js shape
    const scrollToId = `const scrollToId = (id) => {\n  const escaped = id.replace(/["\\\\]/g, "\\\\$&");\n  return document.querySelector(\`[data-slug="\${escaped}"]\`);\n};\nexport {\n  scrollToId\n};\n`;
    expect(scanCjsModule(scrollToId).isEsm).toBe(true);
    expect(isPassthroughCjs('/node_modules/@immediately-run/sdk/scrollToId.js', scrollToId)).toBe(false);
  });

  it('collects require() calls that appear after a regex literal', () => {
    expect(scanCjsModule(`var a = x.replace(/["\\\\]/g, "_"); var b = require("dep");`).requires).toEqual(['dep']);
  });

  it('does not mistake division for a regex (stays CJS)', () => {
    expect(scanCjsModule(`var y = width / 2 / scale; module.exports = y;`).isEsm).toBe(false);
    expect(scanCjsModule(`var a = height/2; var m = require("d");`).requires).toEqual(['d']);
  });

  it('handles a keyword-preceded regex (return /re/) without desync', () => {
    expect(scanCjsModule(`function f(){ return /["]/.test(x); }\nmodule.exports = f;`).isEsm).toBe(false);
    expect(scanCjsModule(`function f(){ return /["]/.test(x); }\nexport default f;`).isEsm).toBe(true);
  });
});

describe('isPassthroughCjs', () => {
  it('passes through CommonJS under /node_modules', () => {
    expect(isPassthroughCjs('/node_modules/react-dom/index.js', 'require("react");')).toBe(true);
  });

  it('keeps ESM node_modules on the Babel path', () => {
    expect(isPassthroughCjs('/node_modules/some-esm/index.js', 'export const a = 1;')).toBe(false);
    expect(isPassthroughCjs('/node_modules/some-esm/index.mjs', 'module.exports={}')).toBe(false);
  });

  it('checks .cjs syntax and always compiles TypeScript extensions', () => {
    expect(isPassthroughCjs('/node_modules/pkg/x.cjs', 'module.exports = import("react");')).toBe(false);
    expect(isPassthroughCjs('/node_modules/pkg/x.cts', 'module.exports = 1;')).toBe(false);
    expect(isPassthroughCjs('/node_modules/pkg/x.ts', 'const x: number = 1;')).toBe(false);
  });

  it('never passes through app source', () => {
    expect(isPassthroughCjs('/app/src/util.js', 'require("react");')).toBe(false);
  });
});

describe('ReactPreset.mapTransformers routing', () => {
  const preset = new ReactPreset();

  it('routes a CommonJS dependency to the Babel-free passthrough', () => {
    const m = mod('/node_modules/react-dom/cjs/react-dom.production.min.js', 'var x=require("react");x?.y;');
    expect(preset.mapTransformers(m)).toEqual([['raw-cjs-transformer', {}]]);
  });

  it('routes an ESM dependency through Babel (ESM→CJS for the CJS runtime)', () => {
    const m = mod('/node_modules/some-esm/index.js', 'import x from "react";export default x;');
    expect(preset.mapTransformers(m).map((t) => t[0])).toContain('babel-transformer');
  });

  it('still transforms app source (JSX entry gets babel + react-refresh)', () => {
    const ids = preset.mapTransformers(mod('/app/src/App.tsx', 'export default () => <div/>;')).map((t) => t[0]);
    expect(ids).toContain('babel-transformer');
    expect(ids).toContain('react-refresh-transformer');
  });

  it('still transforms a non-component app .ts file', () => {
    expect(preset.mapTransformers(mod('/app/src/util.ts', 'export const a=1;')).map((t) => t[0])).toContain(
      'babel-transformer',
    );
  });
});

describe('RawCjsTransformer', () => {
  it('returns dependency source byte-for-byte unchanged + collected deps', async () => {
    // Modern syntax preset-env WOULD lower (optional chaining) — proving no transpile.
    const code = 'var react=require("react");var s=require("scheduler");module.exports=react?.render;';
    const result = await new RawCjsTransformer().transform({ module: mod('/node_modules/react-dom/index.js', code), code });
    if (!('dependencies' in result)) {
      throw new Error('expected a transpilation result, got a BundlerError');
    }
    expect(result.code).toBe(code);
    expect([...result.dependencies]).toEqual(['react', 'scheduler']);
  });
});
