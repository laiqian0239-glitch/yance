'use strict';

function createAbortError(code = 'HTTP_CLIENT_DISCONNECTED') {
  const error = new Error(code);
  error.name = 'AbortError';
  error.code = code;
  return error;
}

function createHttpAbortScope(req, res, options = {}) {
  const controller = new AbortController();
  const code = String(options.code || 'HTTP_CLIENT_DISCONNECTED');
  let disposed = false;

  const abort = reason => {
    if (!controller.signal.aborted) controller.abort(reason || createAbortError(code));
  };
  const onRequestAborted = () => abort();
  const onResponseClose = () => {
    if (!res?.writableEnded) abort();
  };

  req?.once?.('aborted', onRequestAborted);
  res?.once?.('close', onResponseClose);
  if (req?.aborted) abort();

  return {
    signal: controller.signal,
    abort,
    dispose() {
      if (disposed) return;
      disposed = true;
      req?.removeListener?.('aborted', onRequestAborted);
      res?.removeListener?.('close', onResponseClose);
    }
  };
}

module.exports = { createHttpAbortScope };
