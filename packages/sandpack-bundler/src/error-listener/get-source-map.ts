/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

import {
  FlattenMap,
  TraceMap,
  generatedPositionFor,
  originalPositionFor,
  sourceContentFor,
  type SectionedSourceMap,
  type SourceMapInput,
} from '@jridgewell/trace-mapping';

/**
 * A wrapped instance of a <code>{@link https://github.com/jridgewell/sourcemaps TraceMap}</code>.
 *
 * This exposes methods which will be indifferent to changes made in the source map library.
 */
export class SourceMap {
  __source_map: TraceMap;

  constructor(sourceMap: SourceMapInput | SectionedSourceMap) {
    this.__source_map =
      typeof sourceMap === 'object' && 'sections' in sourceMap ? new FlattenMap(sourceMap) : new TraceMap(sourceMap);
  }

  /**
   * Returns the original code position for a generated code position.
   * @param {number} line The line of the generated code position.
   * @param {number} column The column of the generated code position.
   */
  getOriginalPosition(line: number, column: number): { source: string; line: number; column: number } {
    const { line: l, column: c, source: s } = originalPositionFor(this.__source_map, { line, column });
    // All three are null where the map has no mapping; callers check `source`.
    return { line: l as number, column: c as number, source: s as string };
  }

  /**
   * Returns the generated code position for an original position.
   * @param {string} source The source file of the original code position.
   * @param {number} line The line of the original code position.
   * @param {number} column The column of the original code position.
   */
  getGeneratedPosition(source: string, line: number, column: number): { line: number; column: number } {
    const { line: l, column: c } = generatedPositionFor(this.__source_map, { source, line, column });
    return {
      line: l as number,
      column: c as number,
    };
  }

  /**
   * Returns the code for a given source file name.
   * @param {string} sourceName The name of the source file.
   */
  getSource(sourceName: string): string {
    return sourceContentFor(this.__source_map, sourceName) as string;
  }

  getSources(): string[] {
    return this.__source_map.resolvedSources;
  }
}

function extractSourceMapUrl(fileUri: string, fileContents: string) {
  const regex = /\/\/[#@] ?sourceMappingURL=([^\s'"]+)\s*$/gm;
  let match = null;
  for (;;) {
    let next = regex.exec(fileContents);
    if (next == null) {
      break;
    }
    match = next;
  }
  if (!(match && match[1])) {
    return Promise.reject(`Cannot find a source map directive for ${fileUri}.`);
  }
  return Promise.resolve(match[1].toString());
}

/**
 * Returns an instance of <code>{@link SourceMap}</code> for a given fileUri and fileContents.
 * @param {string} fileUri The URI of the source file.
 * @param {string} fileContents The contents of the source file.
 */
async function getSourceMap(fileUri: string, fileContents: string): Promise<SourceMap> {
  let sm = await extractSourceMapUrl(fileUri, fileContents);
  if (sm.indexOf('data:') === 0) {
    const base64 = /^data:application\/json;([\w=:"-]+;)*base64,/;
    const match2 = sm.match(base64);
    if (!match2) {
      throw new Error('Sorry, non-base64 inline source-map encoding is not supported.');
    }
    sm = sm.substring(match2[0].length);
    sm = window.atob(sm);
    return new SourceMap(JSON.parse(sm));
  } else {
    const index = fileUri.lastIndexOf('/');
    const url = fileUri.substring(0, index + 1) + sm;
    const obj = await fetch(url).then((res) => res.json());
    return new SourceMap(obj);
  }
}

export { extractSourceMapUrl, getSourceMap };
export default getSourceMap;
