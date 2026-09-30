import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'};
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const name = url.pathname === '/' ? '/tests/fixture.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(root, `.${name}`);
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) throw new Error('Not found');
    response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store'});
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(8128, '127.0.0.1', () => console.log('Fixture: http://127.0.0.1:8128'));
