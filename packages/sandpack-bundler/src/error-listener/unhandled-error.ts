// Based on https://github.com/facebook/create-react-app/tree/main/packages/react-error-overlay

import { toError } from './thrown-value';

type ErrorCallback = (error: Error) => void;

function errorHandler(callback: ErrorCallback, evt: Event & { error?: any }): void {
  if (!evt.error) {
    return;
  }

  // A non-error has no trace; toError says what was thrown instead.
  callback(toError(evt.error));
}

export function registerUnhandledError(target: EventTarget, callback: ErrorCallback) {
  const boundErrorHandler = errorHandler.bind(undefined, callback);
  target.addEventListener('error', boundErrorHandler);
  return () => {
    target.removeEventListener('error', boundErrorHandler);
  };
}
