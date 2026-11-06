import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip' };
const server = createServer(async (request, response) => {
  const info = JSON.parse(await readFile(path.join(root, 'build-info.json'), 'utf8'));
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const relative = pathname.startsWith(info.base) ? pathname.slice(info.base.length) : pathname === '/vin-scanner/' ? 'index.html' : '';
  const file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(root + path.sep) || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(403); response.end(); return; }
  try {
    const target = (await stat(file)).isDirectory() ? path.join(file, 'index.html') : file;
    const source = `http://${request.headers.host}${info.base}assets/`;
    const dynamic = pathname.endsWith('/paddle/worker.js') ? " 'unsafe-eval'" : '';
    const local = ' data:'; // Local WASM bytes; never an HTTP connection.
    const csp = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'${dynamic}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src blob: mediastream:; worker-src 'self'; connect-src ${source}${local}; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`;
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'Permissions-Policy': 'camera=(self), microphone=()', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    response.end(request.method === 'HEAD' ? undefined : await readFile(target));
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(Number(process.env.PORT || 4317), '127.0.0.1', () => console.log('Diagnostics listening on 127.0.0.1:' + server.address().port));
