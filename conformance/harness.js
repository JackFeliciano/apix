// Small helpers the conformance suites share. Kept dependency-free on purpose.
export { start as startServer } from '../demo/server.js';

export function stopServer(handle) {
  return new Promise((resolve) => {
    if (!handle?.server) return resolve();
    handle.server.close(() => resolve());
    handle.server.closeAllConnections?.();
  });
}

export async function request(base, path, { method = 'GET', token = null, body = null } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, raw, requestId: res.headers.get('x-request-id') };
}

export function showBanner(title) {
  console.log(`\n--- ${title} ---`);
}
