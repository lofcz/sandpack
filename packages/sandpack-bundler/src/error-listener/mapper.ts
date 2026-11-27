/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// @ts-ignore
import { settle } from 'settle-promise';

import { Bundler } from '../bundler/bundler';
import { getLinesAround } from './get-lines-around';
import { SourceMap, getSourceMap } from './get-source-map';
import { modulePathOfSourceURL } from './source-url';
import StackFrame from './stack-frame';

interface MapCacheEntry {
  filepath: string;
  fileSource: string;
  map?: SourceMap | null;
}

/**
 * Enhances a set of <code>StackFrame</code>s with their original positions and code (when available).
 * @param {StackFrame[]} frames A set of <code>StackFrame</code>s which contain (generated) code positions.
 * @param {number} [contextLines=3] The number of lines to provide before and after the line specified in the <code>StackFrame</code>.
 */
async function map(bundler: Bundler, frames: StackFrame[], contextLines: number = 3): Promise<StackFrame[]> {
  const cache: Record<string, MapCacheEntry> = {};
  const fileNames: Set<string> = new Set();
  frames.forEach((frame) => {
    const { fileName } = frame;
    if (fileName == null) {
      return;
    }
    fileNames.add(fileName);
  });

  await settle(
    Array.from(fileNames).map(async (fileName) => {
      // A frame of an evaluated module names it by its sourceURL, which holds
      // the module's own path: nothing to resolve.
      const filepath = modulePathOfSourceURL(fileName);
      const foundModule = filepath === null ? undefined : bundler.getModule(filepath);
      if (filepath !== null && foundModule) {
        const fileSource = foundModule.compiled || foundModule.source;
        if (fileSource) {
          const map = await getSourceMap(fileName, fileSource).catch(() => null);
          cache[fileName] = { filepath, fileSource, map };
        }
      }
    })
  );

  return frames.map((frame) => {
    const { functionName, fileName, lineNumber, columnNumber } = frame;

    // Unknown file, returning original frame
    if (!fileName) {
      return frame;
    }

    // Try to get file source info from cache
    const { map, fileSource, filepath } = cache[fileName] || {};

    // File not known to sandpack, returning original frame
    if (!filepath || lineNumber == null || columnNumber == null || filepath.includes('node_modules')) {
      return frame;
    }

    // There is no map we assume the positions are correct
    if (map == null) {
      return new StackFrame(
        functionName,
        fileName,
        lineNumber,
        columnNumber,
        getLinesAround(lineNumber, contextLines, fileSource),
        functionName,
        filepath,
        lineNumber,
        columnNumber,
        getLinesAround(lineNumber, contextLines, fileSource)
      );
    }

    // There is a sourcemap so we map to the original position
    const { source, line, column } = map.getOriginalPosition(lineNumber, columnNumber);
    const originalSource: string | string[] = source == null ? [] : map.getSource(source);
    return new StackFrame(
      functionName,
      fileName,
      lineNumber,
      columnNumber,
      getLinesAround(lineNumber, contextLines, fileSource),
      functionName,
      // The map names its source by base name only ("App.tsx"); the module's
      // own path says which file that is.
      source == null ? source : filepath,
      line,
      column,
      getLinesAround(line, contextLines, originalSource)
    );
  });
}

export { map };
export default map;
