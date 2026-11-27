/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

import { toError } from './thrown-value';

type ErrorCallback = (error: Error) => void;

export function registerUnhandledRejection(target: EventTarget, callback: ErrorCallback) {
  const rejectionHandler = (err: any) => {
    if (err == null || err.reason == null) {
      return callback(new Error('Unknown'));
    }

    // A non-error has no trace; toError says what was rejected instead.
    return callback(toError(err.reason));
  };

  target.addEventListener('unhandledrejection', rejectionHandler);

  return () => {
    target.removeEventListener('unhandledrejection', rejectionHandler);
  };
}
