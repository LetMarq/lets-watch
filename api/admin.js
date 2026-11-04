// POST /api/admin  { "password": "...", "code": "XXXXXXXX" }
// Checks the admin password (ADMIN_PASSWORD) and returns a token that allows
// ending THAT room. The presenter panel verifies the token at /api/verify
// before obeying.
import { adminToken, isAdminEnabled, isAdminPassword, isValidCode, json } from '../lib/room.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request) {
  if (!isAdminEnabled()) {
    return json({ error: 'A opção de admin não está ativada: defina ADMIN_PASSWORD na Vercel.' }, 503);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // invalid body
  }

  if (!isAdminPassword(body.password)) {
    await wait(1500); // slows down anyone trying to guess the password
    return json({ error: 'Senha incorreta.' }, 401);
  }
  if (!isValidCode(body.code)) {
    return json({ error: 'Código da sala inválido.' }, 400);
  }

  return json({ token: adminToken(body.code) });
}
