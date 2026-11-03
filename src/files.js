// The file store. A file belongs to a tenant, is addressed by its content hash,
// and a second upload of the same bytes writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireTenant } from './store.js';

export class FileStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  put(tenant, name, bytes, contentType = 'application/octet-stream') {
    requireTenant(tenant);
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const tenantDir = path.join(this.dir, tenant);
    fs.mkdirSync(tenantDir, { recursive: true });
    const full = path.join(tenantDir, hash);
    if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
    return {
      tenant,
      name,
      hash,
      size: buf.length,
      content_type: contentType,
      url: `/files/${tenant}/${hash}`,
      deduplicated: fs.existsSync(full),
    };
  }

  get(tenant, hash) {
    requireTenant(tenant);
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw Object.assign(new Error('bad hash'), { code: 'file_bad_hash' });
    }
    const full = path.join(this.dir, tenant, hash);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
  }

  // A module asks the store whether the tenant owns this content before serving it.
  owns(tenant, hash) {
    requireTenant(tenant);
    return /^[a-f0-9]{64}$/.test(hash) && fs.existsSync(path.join(this.dir, tenant, hash));
  }
}
