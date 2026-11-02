// Funções compartilhadas pelas rotas da API.
// Uma "sala" não fica guardada em banco de dados: o código é aleatório e a
// chave do apresentador é uma assinatura (HMAC) desse código com o
// LETSWATCH_SECRET. Assim qualquer rota consegue conferir a chave sem estado.
import crypto from 'node:crypto';

// Sem caracteres parecidos (0/O, 1/l/I) para facilitar ditar o código.
const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FORMATO_CODIGO = /^[A-Za-z0-9]{8}$/;

export function gerarCodigo(tamanho = 8) {
  let codigo = '';
  for (const byte of crypto.randomBytes(tamanho)) {
    codigo += ALFABETO[byte % ALFABETO.length];
  }
  return codigo;
}

function segredo() {
  const s = process.env.LETSWATCH_SECRET;
  if (!s) throw new Error('A variável LETSWATCH_SECRET não está definida.');
  return s;
}

export function chaveDoApresentador(codigo) {
  return crypto
    .createHmac('sha256', segredo())
    .update(codigo)
    .digest('base64url')
    .slice(0, 22);
}

export function chaveValida(codigo, chave) {
  if (!FORMATO_CODIGO.test(codigo ?? '') || typeof chave !== 'string') return false;
  const esperada = Buffer.from(chaveDoApresentador(codigo));
  const recebida = Buffer.from(chave);
  return esperada.length === recebida.length && crypto.timingSafeEqual(esperada, recebida);
}

function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- Admin ----------
// A senha fica só na variável ADMIN_PASSWORD. Quem acerta a senha recebe um
// "token de admin" para UMA sala: uma assinatura de "admin:<codigo>" que o
// painel do apresentador confere antes de obedecer ao comando.

export function adminConfigurado() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function senhaAdminCorreta(senha) {
  const certa = process.env.ADMIN_PASSWORD;
  if (!certa || typeof senha !== 'string') return false;
  // Compara os hashes para não vazar o tamanho da senha pelo tempo de resposta.
  const hash = (v) => crypto.createHash('sha256').update(v).digest();
  return crypto.timingSafeEqual(hash(senha), hash(certa));
}

export function tokenAdmin(codigo) {
  return crypto.createHmac('sha256', segredo()).update(`admin:${codigo}`).digest('base64url');
}

export function tokenAdminValido(codigo, token) {
  if (!FORMATO_CODIGO.test(codigo ?? '') || typeof token !== 'string') return false;
  return iguais(tokenAdmin(codigo), token);
}

export function codigoValido(codigo) {
  return FORMATO_CODIGO.test(codigo ?? '');
}

export function limparTitulo(titulo) {
  return String(titulo ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// Endereço público do site, ex.: https://letswatch.vercel.app
export function urlBase(request) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocolo =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  if (host) return `${protocolo.split(',')[0]}://${host}`;
  return new URL(request.url).origin;
}

export function linkPublico(request, codigo) {
  return `${urlBase(request)}/ver/${codigo}`;
}

export function linkApresentador(request, codigo, titulo) {
  const params = new URLSearchParams({ k: chaveDoApresentador(codigo) });
  const t = limparTitulo(titulo);
  if (t) params.set('titulo', t);
  return `${urlBase(request)}/transmitir/${codigo}?${params}`;
}

export function criarSala(request, titulo) {
  const codigo = gerarCodigo();
  return {
    codigo,
    titulo: limparTitulo(titulo),
    linkApresentador: linkApresentador(request, codigo, titulo),
    linkPublico: linkPublico(request, codigo),
  };
}

export function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
