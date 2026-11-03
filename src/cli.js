// `node src/server.js token --tenant acme --sub user_1 --perms shop.read,shop.checkout`
import { sign } from './token.js';

const SECRET = process.env.APIX_SECRET ?? 'apix-dev-secret-change-me';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

export async function tokenCommand() {
  const tenant = arg('tenant');
  if (!tenant) {
    console.error('usage: node src/server.js token --tenant <id> [--sub <subject>] [--perms a,b] [--ttl 900]');
    process.exit(1);
  }
  const sub = arg('sub', 'dev');
  const perms = (arg('perms', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ttl = Number(arg('ttl', '900'));
  console.log(sign({ tenant, sub, perms }, SECRET, ttl));
}
