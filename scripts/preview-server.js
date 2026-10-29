import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || path.split('/').some(p => p.startsWith('.')) || !mime[extname(file)]) {
      res.writeHead(403).end('Forbidden'); return;
    }
    if (!(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Tabless preview: http://127.0.0.1:4173 (sample data only)'));
