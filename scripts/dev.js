// Servidor local para testar no seu computador:  npm run dev
// Imita o que a Vercel faz: serve a pasta public/, as rotas /ver e /transmitir,
// e as funções da pasta api/.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

try {
  process.loadEnvFile();
} catch {
  // sem .env
}

if (!process.env.LETSWATCH_SECRET) {
  process.env.LETSWATCH_SECRET = 'segredo-so-para-testes-locais';
  console.warn('Aviso: LETSWATCH_SECRET vazio. Usando um segredo de teste.');
}

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pastaPublica = path.join(raiz, 'public');
const porta = Number(process.env.PORT || 3000);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function lerCorpo(req) {
  const partes = [];
  for await (const parte of req) partes.push(parte);
  return Buffer.concat(partes);
}

async function rodarApi(req, res, nome) {
  const arquivo = path.join(raiz, 'api', `${nome}.js`);
  let modulo;
  try {
    modulo = await import(pathToFileURL(arquivo).href);
  } catch {
    res.writeHead(404).end('Rota não encontrada');
    return;
  }
  const handler = modulo[req.method];
  if (!handler) {
    res.writeHead(405).end('Método não permitido');
    return;
  }
  const corpo = ['GET', 'HEAD'].includes(req.method) ? undefined : await lerCorpo(req);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: corpo,
  });
  const resposta = await handler(request);
  res.writeHead(resposta.status, Object.fromEntries(resposta.headers));
  res.end(Buffer.from(await resposta.arrayBuffer()));
}

async function servirArquivo(res, caminho) {
  const destino = path.normalize(path.join(pastaPublica, caminho));
  if (!destino.startsWith(pastaPublica)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const conteudo = await fs.readFile(destino);
    res.writeHead(200, { 'content-type': TIPOS[path.extname(destino)] ?? 'application/octet-stream' });
    res.end(conteudo);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Página não encontrada');
  }
}

http
  .createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const api = pathname.match(/^\/api\/([\w-]+)$/);
      if (api) return await rodarApi(req, res, api[1]);
      if (/^\/ver\/[^/]+$/.test(pathname)) return await servirArquivo(res, 'ver.html');
      if (/^\/transmitir\/[^/]+$/.test(pathname)) return await servirArquivo(res, 'transmitir.html');
      if (pathname === '/') return await servirArquivo(res, 'index.html');
      return await servirArquivo(res, decodeURIComponent(pathname));
    } catch (erro) {
      console.error(erro);
      res.writeHead(500).end('Erro interno');
    }
  })
  .listen(porta, () => {
    console.log(`LetsWatch rodando em http://localhost:${porta}`);
  });
