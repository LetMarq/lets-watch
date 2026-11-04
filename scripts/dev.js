// Local server for testing on your computer:  npm run dev
// Mimics what Vercel does: serves public/, the /ver, /transmitir, /admin and
// /turn pages, and the functions in api/.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

try {
  process.loadEnvFile();
} catch {
  // no .env
}

if (!process.env.LETSWATCH_SECRET) {
  process.env.LETSWATCH_SECRET = 'local-testing-only-secret';
  console.warn('Warning: LETSWATCH_SECRET is empty. Using a test secret.');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 3000);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Same rewrites as vercel.json
const PAGES = [
  [/^\/$/, 'index.html'],
  [/^\/ver\/[^/]+$/, 'watch.html'],
  [/^\/transmitir\/[^/]+$/, 'present.html'],
  [/^\/admin$/, 'admin.html'],
  [/^\/turn$/, 'turn.html'],
];

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function runApi(req, res, name) {
  const file = path.join(root, 'api', `${name}.js`);
  let module;
  try {
    module = await import(pathToFileURL(file).href);
  } catch {
    res.writeHead(404).end('Route not found');
    return;
  }
  const handler = module[req.method];
  if (!handler) {
    res.writeHead(405).end('Method not allowed');
    return;
  }
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body,
  });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveFile(res, relativePath) {
  const target = path.normalize(path.join(publicDir, relativePath));
  if (!target.startsWith(publicDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const content = await fs.readFile(target);
    res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Page not found');
  }
}

http
  .createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const api = pathname.match(/^\/api\/([\w-]+)$/);
      if (api) return await runApi(req, res, api[1]);
      const page = PAGES.find(([pattern]) => pattern.test(pathname));
      if (page) return await serveFile(res, page[1]);
      return await serveFile(res, decodeURIComponent(pathname));
    } catch (error) {
      console.error(error);
      res.writeHead(500).end('Internal error');
    }
  })
  .listen(port, () => {
    console.log(`LetsWatch running at http://localhost:${port}`);
  });
