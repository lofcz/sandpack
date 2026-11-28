// Bundler modules read the browser `self` global while they load
// (src/bundler/module/eval.ts). Node has none; a jsdom test file already does.
globalThis.self ??= globalThis as typeof self;
