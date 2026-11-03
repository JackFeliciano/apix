// The manifest. A module declares what it joins with, and the runtime reads the
// routes out of it. Nothing serves a route the manifest does not name.
export function defineModule(manifest) {
  const required = ['name', 'version', 'routes'];
  for (const field of required) {
    if (!manifest[field]) throw new Error(`manifest missing ${field}`);
  }
  if (!Array.isArray(manifest.routes) || manifest.routes.length === 0) {
    throw new Error('manifest needs at least one route');
  }

  const seen = new Set();
  for (const route of manifest.routes) {
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(route.method ?? '')) {
      throw new Error(`route ${route.path} has no valid method`);
    }
    if (typeof route.path !== 'string' || !route.path.startsWith('/')) {
      throw new Error(`route path must start with a slash: ${route.path}`);
    }
    if (typeof route.permission !== 'string' || route.permission === '') {
      throw new Error(`route ${route.method} ${route.path} declares no permission`);
    }
    if (typeof route.handler !== 'function') {
      throw new Error(`route ${route.method} ${route.path} has no handler`);
    }
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) throw new Error(`duplicate route: ${key}`);
    seen.add(key);
  }

  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? '',
    permissions: manifest.permissions ?? [],
    events: manifest.events ?? [],
    routes: manifest.routes,
  };
}
