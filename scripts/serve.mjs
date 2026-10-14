import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL(process.argv.includes('--dist') ? '../dist/' : '../', import.meta.url));
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = resolve(root, '.' + pathname);
    if (filename !== resolve(root) && !filename.startsWith(resolve(root) + sep)) { res.writeHead(403).end('Forbidden'); return; }
    let target = filename;
    if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`端口 ${port} 已占用。请关闭此前的预览，或设置 PORT 后重试。`);
  else console.error(error.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => console.log(`本地预览已启动： http://localhost:${port}/\n按 Ctrl+C 停止。`));
