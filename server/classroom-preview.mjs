import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import classroom from '../worker/classroom.ts';

export function classroomPreview(root) {
  const folder = join(homedir(), '.cache', 'classroom-air-preview', createHash('sha256').update(root).digest('hex').slice(0, 16));
  mkdirSync(folder, { recursive: true });
  const sqlite = new DatabaseSync(join(folder, 'classroom-preview.sqlite'));
  sqlite.exec(readFileSync(join(root, 'schema.sql'), 'utf8'));
  const DB = { prepare: sql => ({ bind: (...args) => ({
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
  }) }) };
  const handle = async (req, res) => {
    const chunks = [];
    let length = 0;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      for await (const bytes of req.iterator({ destroyOnReturn: false })) {
        length += bytes.length;
        if (length > 2048) {
          res.writeHead(413, { 'Cache-Control': 'no-store' }).end();
          req.resume();
          return;
        }
        chunks.push(bytes);
      }
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const response = await classroom.fetch(new Request(`http://preview${req.url.slice(4)}`, {
      method: req.method, headers, body: length ? Buffer.concat(chunks) : undefined,
    }), { DB, TEACHER_PIN: process.env.TEACHER_PIN });
    res.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text());
  };
  return { handle, close: () => sqlite.close() };
}
