// Helpers shared by the API routes.
// Rooms are not stored in a database: the room code is random and the
// presenter key is an HMAC signature of that code with LETSWATCH_SECRET,
// so any route can check a key without keeping state.
import crypto from 'node:crypto';

// No look-alike characters (0/O, 1/l/I), so codes are easy to read out loud.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_FORMAT = /^[A-Za-z0-9]{8}$/;

export function generateCode(length = 8) {
  let code = '';
  for (const byte of crypto.randomBytes(length)) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

export function isValidCode(code) {
  return CODE_FORMAT.test(code ?? '');
}

function secret() {
  const value = process.env.LETSWATCH_SECRET;
  if (!value) throw new Error('A variável LETSWATCH_SECRET não está definida.');
  return value;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- Presenter key ----------

export function presenterKey(code) {
  return crypto.createHmac('sha256', secret()).update(code).digest('base64url').slice(0, 22);
}

export function isValidPresenterKey(code, key) {
  if (!isValidCode(code) || typeof key !== 'string') return false;
  return safeEqual(presenterKey(code), key);
}

// ---------- Admin ----------
// The password lives only in ADMIN_PASSWORD. Whoever gets it right receives an
// "admin token" for ONE room: a signature of "admin:<code>" that the presenter
// panel verifies before obeying the command.

export function isAdminEnabled() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function isAdminPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof password !== 'string') return false;
  // Compare hashes so response time doesn't leak the password length.
  const hash = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(hash(password), hash(expected));
}

export function adminToken(code) {
  return crypto.createHmac('sha256', secret()).update(`admin:${code}`).digest('base64url');
}

export function isValidAdminToken(code, token) {
  if (!isValidCode(code) || typeof token !== 'string') return false;
  return safeEqual(adminToken(code), token);
}

// ---------- Rooms and links ----------

export function cleanTitle(title) {
  return String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// Public site address, e.g. https://letswatch.vercel.app
export function baseUrl(request) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  if (host) return `${protocol.split(',')[0]}://${host}`;
  return new URL(request.url).origin;
}

// The public URLs stay in Portuguese (/ver, /transmitir): they are what people see and share.
export function watchLink(request, code) {
  return `${baseUrl(request)}/ver/${code}`;
}

export function presenterLink(request, code, title) {
  const params = new URLSearchParams({ k: presenterKey(code) });
  const cleaned = cleanTitle(title);
  if (cleaned) params.set('title', cleaned);
  return `${baseUrl(request)}/transmitir/${code}?${params}`;
}

export function createRoom(request, title) {
  const code = generateCode();
  return {
    code,
    title: cleanTitle(title),
    presenterLink: presenterLink(request, code, title),
    watchLink: watchLink(request, code),
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
