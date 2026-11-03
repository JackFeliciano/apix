// The envelope. Every response leaves in this shape, success or failure.
// data + meta on success, error + meta on failure, and meta carries the request id.
import crypto from 'node:crypto';

export function requestId() {
  return `req_${crypto.randomUUID()}`;
}

export function ok(data, meta = {}) {
  return { data, meta };
}

export function fail(code, message, details = null, meta = {}) {
  const error = { code, message };
  if (details !== null) error.details = details;
  return { error, meta };
}

// JSON in, JSON out, with the headers a client reads.
export function send(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-request-id': body?.meta?.request_id ?? '',
    ...extraHeaders,
  });
  res.end(payload);
}
